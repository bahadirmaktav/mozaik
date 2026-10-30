import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  allDocuments,
  createDocument,
  dirty,
  getDocument,
  updateDocument,
} from "../plugins/text-editor/documents";

export interface FileData {
  path: string;
  name: string;
  text: string;
  revision: string;
  bom: boolean;
  ending: "lf" | "crlf" | "mixed";
}
export interface Recovery {
  key: string;
  name: string;
  text: string;
  bom: boolean;
  ending: "lf" | "crlf" | "mixed";
  /** Set for an Excalidraw scene or a Mermaid diagram; text documents have none. */
  kind?: "drawing" | "mermaid";
}
export function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return isTauri()
    ? invoke(command, args)
    : Promise.reject(new Error("This action requires the Mozaik desktop app."));
}
export async function openFile(path?: string) {
  const file = await native<FileData | null>("open_file", {
    path: path ?? null,
  });
  if (!file) return null;
  const existing = allDocuments().find((d) => d.path === file.path);
  return existing?.id ?? createDocument({ ...file, saved: file.text });
}
const saves = new Map<string, Promise<boolean>>();
/** Runs before a document is written, such as the IDE's format on save. Hooks report their
 * own failures; a failing hook never prevents the save. */
export const beforeSave = new Set<(id: string) => Promise<void>>();
export function saveDocument(id: string, saveAs = false): Promise<boolean> {
  const prior = saves.get(id) ?? Promise.resolve(true);
  const next = prior.catch(() => false).then(() => performSave(id, saveAs));
  saves.set(id, next);
  void next
    .finally(() => {
      if (saves.get(id) === next) saves.delete(id);
    })
    .catch(() => {});
  return next;
}
async function performSave(id: string, saveAs: boolean) {
  for (const hook of beforeSave) await hook(id).catch(() => {});
  const doc = getDocument(id),
    text = doc.text;
  const result = await native<FileData | null>("save_file", {
    request: {
      path: saveAs ? null : doc.path,
      text,
      revision: saveAs ? null : doc.revision,
      bom: doc.bom,
      ending: doc.ending,
      name: doc.name,
      excludedPaths: allDocuments()
        .filter((d) => d.id !== id && d.path)
        .map((d) => d.path),
    },
  });
  if (!result) return false;
  updateDocument(id, {
    path: result.path,
    name: result.name,
    saved: text,
    revision: result.revision,
    conflict: null,
  });
  return true;
}
export async function checkExternal(id: string) {
  const doc = getDocument(id);
  if (!doc.path) return;
  const file = await native<FileData | null>("check_file", {
    path: doc.path,
    revision: doc.revision,
  });
  if (!file) return;
  const current = getDocument(id);
  if (current.path !== doc.path || current.revision !== doc.revision) return;
  if (dirty(current))
    updateDocument(id, {
      conflict:
        "The file changed on disk. Save As to preserve your edits, or reload the disk version.",
    });
  else updateDocument(id, { ...file, saved: file.text, conflict: null });
}
