export interface PassageTabPointerIntent {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** Match the desktop browser convention without turning ordinary travel into tabs. */
export function passageTabOpenIntent(intent: PassageTabPointerIntent): boolean {
  return intent.button === 1 || intent.metaKey || intent.ctrlKey;
}
