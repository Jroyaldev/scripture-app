/**
 * Last-used input modality. Marking chrome uses this to decide whether a new
 * text selection may move focus into its toolbar: for keyboard users that
 * transfer is the only way to reach the tools, but for pointer and screen-
 * reader users an unsolicited focus jump yanks them out of the text they
 * were reading or hearing.
 */

let modality: "keyboard" | "pointer" = "pointer";

if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => { modality = "keyboard"; }, true);
  window.addEventListener("pointerdown", () => { modality = "pointer"; }, true);
}

export function lastInputModality(): "keyboard" | "pointer" {
  return modality;
}
