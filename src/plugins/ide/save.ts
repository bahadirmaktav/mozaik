import { getDocument, hasDocument } from "../text-editor/documents";
import { host, message, viewOf } from "./editors";
import { settingsFor } from "./projects";

const FORMAT_TIMEOUT = 3000;

/** Format on save: runs before a code document is written when its project asks for it.
 * A slow or failing formatter never blocks the save; the file is saved unformatted. */
export async function formatBeforeSave(id: string) {
  if (!hasDocument(id)) return;
  const doc = getDocument(id);
  const view = viewOf(id);
  if (!doc.path || !view || !settingsFor(doc.path).formatOnSave) return;
  const { format } = await import("./lsp");
  try {
    await Promise.race([
      format(view, false, doc.path),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("the formatter did not answer in time")),
          FORMAT_TIMEOUT,
        ),
      ),
    ]);
  } catch (e) {
    host().report(`Saved without formatting: ${message(e)}`);
  }
}
