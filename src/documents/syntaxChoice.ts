import { useSyncExternalStore } from "react";

/**
 * The language a Text Editor document was set to from its status bar, as in Sublime Text's
 * syntax menu (a `.jsonc` file shown as JSON). Kept in the window's memory per document;
 * without a choice the file name decides. A rename to a known type drops the choice.
 */
const chosen = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((fn) => fn());
}
export function onSyntaxChoice(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useSyntaxChoice(id: string) {
  useSyncExternalStore(onSyntaxChoice, () => version);
  return chosen.get(id) ?? null;
}
export const chosenSyntax = (id: string) => chosen.get(id) ?? null;
/** Sets the document's language; `null` goes back to the one detected from its name. */
export function chooseSyntax(id: string, language: string | null) {
  if ((chosen.get(id) ?? null) === language) return;
  if (language === null) chosen.delete(id);
  else chosen.set(id, language);
  emit();
}
export function forgetSyntax(id: string) {
  chosen.delete(id);
}
