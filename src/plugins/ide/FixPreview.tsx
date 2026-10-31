import { Dialog } from "../../components/Dialog";
import { closePreview, usePreview } from "./analysis";
import { host } from "./editors";
import { displayPath } from "./lsp";

/**
 * clang-tidy's fixes as a diff before they change anything. Apply edits open files in their
 * editors (undoable, unsaved) and asks again before saving files that are not open.
 */
export function FixPreview() {
  const preview = usePreview();
  if (!preview) return null;
  return (
    <Dialog title={preview.title} onCancel={closePreview}>
      <div className="fix-preview" aria-label="Changes">
        {preview.files.map(({ path, hunks }) => (
          <section key={path}>
            <h3 title={path}>{displayPath(path)}</h3>
            {hunks.map((hunk) => (
              <pre key={hunk.line} className="fix-hunk">
                <span className="muted">@@ line {hunk.line + 1}</span>
                {"\n"}
                {hunk.removed.map((line, i) => (
                  <span key={`r${i}`} className="fix-removed">
                    - {line}
                    {"\n"}
                  </span>
                ))}
                {hunk.added.map((line, i) => (
                  <span key={`a${i}`} className="fix-added">
                    + {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            ))}
          </section>
        ))}
      </div>
      {preview.skipped > 0 && (
        <p className="muted">
          {preview.skipped} fix{preview.skipped === 1 ? "" : "es"} overlapping
          another {preview.skipped === 1 ? "is" : "are"} left out; run the
          analysis again after applying these.
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={closePreview}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          data-autofocus
          onClick={() => {
            const apply = preview.apply;
            closePreview();
            void apply().catch((e) => host().report(e));
          }}
        >
          Apply
        </button>
      </div>
    </Dialog>
  );
}
