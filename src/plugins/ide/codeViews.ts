import { editorStates } from "../text-editor/documents";

/**
 * A document's other views: splitting a code file shows it in a second tab, as in VS Code.
 * The document's own tab has the document's ID; another view's tab has its own ID, its own
 * editor state and the same text (`CodeEditor.tsx`), and closes without asking, since the
 * document stays open.
 */
const views = new Map<string, string>();
export function createCodeView(document: string) {
  const id = crypto.randomUUID();
  views.set(id, document);
  return id;
}
export const viewDocument = (id: string) => views.get(id) ?? null;
export const viewsOfDocument = (document: string) =>
  [...views].filter(([, d]) => d === document).map(([id]) => id);
export function disposeCodeView(id: string) {
  views.delete(id);
  editorStates.delete(id);
}
