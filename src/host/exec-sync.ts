import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

/**
 * `execFileSync`, retried when the syscall was INTERRUPTED rather than failed.
 *
 * `execFileSync` is `spawnSync` underneath, and `spawnSync` reads the child's
 * stdout through a pipe. A signal delivered to this process while that read is
 * blocked makes the read return EINTR — POSIX for "nothing went wrong, ask
 * again" — and libuv surfaces it as a thrown `EINTR: interrupted system call,
 * read`. Nothing about the command failed; the parent was simply interrupted
 * while waiting for it.
 *
 * Electron's main process is a bad place to assume that will not happen: every
 * renderer, GPU and utility helper is a child, so SIGCHLD arrives routinely,
 * and the library engine shells out to `git` on the startup path. An engine
 * that refuses to start because a helper process exited at the wrong moment is
 * reporting the interruption as a failure to open the library.
 *
 * Retrying is the whole fix, and it must be narrow: EINTR only. A timeout, a
 * non-zero exit, a missing binary — every one of those is a real answer and is
 * rethrown untouched. Retries are immediate, because the condition is already
 * over by the time it is observed, and bounded, so a genuine signal storm ends
 * as an error rather than a spin.
 *
 * `run` is injectable so the retry can be tested without arranging for a real
 * signal to land inside a real syscall.
 */
const INTERRUPT_ATTEMPTS = 5;

export type ExecFileSyncRunner = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding,
) => string;

export function wasInterrupted(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as NodeJS.ErrnoException;
  if (candidate.code === "EINTR") return true;
  // spawnSync can report the interruption on the result rather than the code,
  // in which case the message is the only thing carrying it.
  return typeof candidate.message === "string" && candidate.message.includes("EINTR");
}

export function execFileSyncInterruptible(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding,
  run: ExecFileSyncRunner = defaultRunner,
): string {
  let interruption: unknown;
  for (let attempt = 0; attempt < INTERRUPT_ATTEMPTS; attempt += 1) {
    try {
      return run(file, args, options);
    } catch (error) {
      if (!wasInterrupted(error)) throw error;
      interruption = error;
    }
  }
  throw interruption;
}

function defaultRunner(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding,
): string {
  return execFileSync(file, [...args], options);
}

/**
 * `readFileSync`, retried when the read was INTERRUPTED rather than failed.
 *
 * Node does not retry this for you. `fs.readFileSync` surfaces EINTR straight
 * out of `node:fs` — the engine's own failure came back as
 * `at readFileSync (node:fs:442:20)` — so a signal landing while the library
 * manifest is being read reports as a library that cannot be opened.
 *
 * Same contract as the exec wrapper above: EINTR only, immediate, bounded.
 * ENOENT, EACCES, EISDIR and every other real answer are rethrown untouched,
 * because callers here routinely branch on a file being absent.
 */
type ReadPath = Parameters<typeof readFileSync>[0];
type TextOptions = BufferEncoding | { encoding: BufferEncoding; flag?: string };

/* Text when an encoding is given, bytes when it is not — the same two shapes
   readFileSync itself offers, so call sites did not have to change to adopt
   this. Binary reads need the retry as much as text ones. */
export function readFileSyncInterruptible(
  path: ReadPath, options: TextOptions, read?: typeof readFileSync,
): string;
export function readFileSyncInterruptible(
  path: ReadPath, options?: undefined, read?: typeof readFileSync,
): Buffer;
export function readFileSyncInterruptible(
  path: ReadPath,
  options?: TextOptions,
  read: typeof readFileSync = readFileSync,
): string | Buffer {
  let interruption: unknown;
  for (let attempt = 0; attempt < INTERRUPT_ATTEMPTS; attempt += 1) {
    try {
      return options === undefined ? read(path) : read(path, options);
    } catch (error) {
      if (!wasInterrupted(error)) throw error;
      interruption = error;
    }
  }
  throw interruption;
}
