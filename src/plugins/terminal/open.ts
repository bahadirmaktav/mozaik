/**
 * How other modules open a terminal in a folder (the File Manager's Open in Terminal): the
 * workspace adds it as a tab of a Terminal panel, or a new panel beside.
 */
let opener: ((directory: string) => void) | null = null;
export function setTerminalOpener(open: typeof opener) {
  opener = open;
}
export const terminals = {
  /** Returns false when no workspace takes terminals (nothing is opened). */
  open(directory: string) {
    if (!opener) return false;
    opener(directory);
    return true;
  },
};
