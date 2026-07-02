/**
 * Safe IPC call wrapper — catches rejections and returns a typed error result.
 * Prevents unhandled promise rejections from hanging the UI in loading states.
 */
export type SafeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export async function safeCall<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
