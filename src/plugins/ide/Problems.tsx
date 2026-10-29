import type { ViewProps } from "../contract";
import { host, reveal, useEditors } from "./editors";
import { displayPath } from "./lsp";

const SEVERITY = ["", "Error", "Warning", "Info", "Hint"];

/** Language server diagnostics of every open project file, by file. */
export default function Problems(_: ViewProps) {
  const { diagnostics } = useEditors();
  const files = [...diagnostics.values()].sort((a, b) =>
    displayPath(a.path).localeCompare(displayPath(b.path)),
  );
  const count = files.reduce((n, f) => n + f.items.length, 0);
  return (
    <div className="problems">
      {!count ? (
        <p className="muted problems-empty">
          No problems. Diagnostics appear here for C/C++ files open in a project
          with a running language server.
        </p>
      ) : (
        <ul className="problems-list" aria-label="Problems">
          {files.map(({ path, items }) => (
            <li key={path}>
              <div className="results-file" title={path}>
                {displayPath(path)}{" "}
                <span className="muted">{items.length}</span>
              </div>
              <ul>
                {[...items]
                  .sort(
                    (a, b) =>
                      a.severity - b.severity ||
                      a.range.start.line - b.range.start.line,
                  )
                  .map((item, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        className={`problem severity-${item.severity}`}
                        onClick={() =>
                          void reveal(path, item.range.start).catch((e) =>
                            host().report(e),
                          )
                        }
                      >
                        <span className="problem-severity">
                          {SEVERITY[item.severity] ?? "Info"}
                        </span>
                        <span className="problem-message">{item.message}</span>
                        <span className="muted">
                          {item.range.start.line + 1}:
                          {item.range.start.character + 1}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
