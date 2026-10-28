import { useSyncExternalStore } from 'react';
import type { EditorState } from '@codemirror/state';

export interface Document {
  id: string;
  name: string;
  path: string | null;
  text: string;
  saved: string;
  revision: string | null;
  bom: boolean;
  ending: 'lf' | 'crlf' | 'mixed';
  conflict: string | null;
  generation: number;
}
const documents = new Map<string, Document>();
const listeners = new Set<() => void>();
// EditorState contains selection, scroll-independent view state and undo history, not DOM.
export const editorStates = new Map<string, EditorState>();
let version = 0;
function emit() { version++; listeners.forEach(fn => fn()); }
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const allDocuments = () => [...documents.values()];
export const hasDocument = (id: string) => documents.has(id);
export function getDocument(id: string) { const doc = documents.get(id); if (!doc) throw new Error('Document was closed'); return doc; }
export function createDocument(input: Partial<Document> = {}) {
  const id = crypto.randomUUID();
  documents.set(id, { id, name: 'Untitled', path: null, text: '', saved: '', revision: null, bom: false, ending: 'lf', conflict: null, generation: 0, ...input });
  emit(); return id;
}
export function updateDocument(id: string, change: Partial<Document>) {
  const doc = getDocument(id);
  documents.set(id, { ...doc, ...change, generation: doc.generation + 1 }); emit();
}
export const dirty = (doc: Document) => doc.text !== doc.saved;
export function disposeDocument(id: string) { documents.delete(id); editorStates.delete(id); emit(); }
export function useDocuments() {
  useSyncExternalStore(subscribe, () => version);
  return allDocuments();
}
