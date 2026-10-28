import { useSyncExternalStore } from "react";
import type { Compartment, EditorState } from "@codemirror/state";

export interface Document {
  id: string;
  name: string;
  path: string | null;
  text: string;
  saved: string;
  revision: string | null;
  bom: boolean;
  ending: "lf" | "crlf" | "mixed";
  conflict: string | null;
  generation: number;
}
interface Store {
  documents: Map<string, Document>;
  listeners: Set<() => void>;
  editorStates: Map<string, EditorState>;
  syntaxCompartments: Map<string, Compartment>;
  version: number;
}
// Preserve unsaved work during development HMR as well as ordinary view remounts.
const store: Store = import.meta.hot?.data.documentStore ?? {
  documents: new Map(),
  listeners: new Set(),
  editorStates: new Map(),
  syntaxCompartments: new Map(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.documentStore = store;
const { documents, listeners } = store;
// EditorState contains selection, scroll-independent view state and undo history, not DOM.
export const editorStates = store.editorStates;
export const syntaxCompartments = store.syntaxCompartments;
function emit() {
  store.version++;
  listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const allDocuments = () => [...documents.values()];
export const hasDocument = (id: string) => documents.has(id);
export function getDocument(id: string) {
  const doc = documents.get(id);
  if (!doc) throw new Error("Document was closed");
  return doc;
}
export function createDocument(input: Partial<Omit<Document, "id">> = {}) {
  const id = crypto.randomUUID();
  documents.set(id, {
    id,
    name: "Untitled",
    path: null,
    text: "",
    saved: "",
    revision: null,
    bom: false,
    ending: "lf",
    conflict: null,
    generation: 0,
    ...input,
  });
  emit();
  return id;
}
export function updateDocument(id: string, change: Partial<Document>) {
  const doc = getDocument(id);
  documents.set(id, { ...doc, ...change, generation: doc.generation + 1 });
  emit();
}
export const dirty = (doc: Document) => doc.text !== doc.saved;
export function disposeDocument(id: string) {
  documents.delete(id);
  editorStates.delete(id);
  syntaxCompartments.delete(id);
  emit();
}
export function useDocuments() {
  useSyncExternalStore(subscribe, () => store.version);
  return allDocuments();
}
