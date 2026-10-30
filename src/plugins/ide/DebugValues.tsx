import { useEffect, useState } from "react";
import { ChevronIcon } from "../../components/Icons";
import {
  loadChildren,
  setExpanded,
  setVariable,
  useDebug,
  type Variable,
} from "./debug";
import { host, message } from "./editors";

/**
 * A variable and, once expanded, its children, read lazily from the adapter (large
 * containers in pages). Expansion is kept by the row's path of names, so it survives steps.
 * `parent` allows Set Value (double-click the value) where the adapter supports it.
 */
export function VariableNode({
  variable,
  parent,
  path,
  depth,
}: {
  variable: Variable;
  parent: number;
  path: string;
  depth: number;
}) {
  const store = useDebug();
  const reference = variable.variablesReference;
  const open = reference > 0 && store.expanded.has(path);
  const children = reference ? store.children.get(reference) : undefined;
  const announced = variable.indexedVariables ?? null;
  const [editing, setEditing] = useState(false);
  const editable =
    parent > 0 && !!store.session?.caps.supportsSetVariable && !!variable.name;
  useEffect(() => {
    if (open && !children) void loadChildren(reference, false, announced);
  }, [open, children, reference, announced]);
  return (
    <>
      <div
        className="debug-row"
        role="treeitem"
        aria-expanded={reference ? open : undefined}
        aria-level={depth + 1}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={variable.type}
        onClick={() => reference && setExpanded(path, !open)}
      >
        <span
          className={`debug-twisty${reference ? "" : " leaf"}${open ? " open" : ""}`}
        >
          {reference > 0 && <ChevronIcon />}
        </span>
        {variable.name && (
          <span className="debug-name">
            {variable.name}
            {variable.value !== "" && ": "}
          </span>
        )}
        {editing ? (
          <input
            className="debug-edit"
            aria-label={`New value of ${variable.name}`}
            defaultValue={variable.value}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter") {
                const value = event.currentTarget.value;
                setEditing(false);
                void setVariable(parent, variable, value).catch((e) =>
                  host().report(message(e)),
                );
              }
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span
            className="debug-value"
            title={editable ? "Double-click to set the value" : undefined}
            onDoubleClick={(event) => {
              if (!editable) return;
              event.stopPropagation();
              setEditing(true);
            }}
          >
            {variable.value}
          </span>
        )}
      </div>
      {open && children && (
        <Children
          reference={reference}
          path={path}
          depth={depth + 1}
          announced={announced}
        />
      )}
    </>
  );
}
function Children({
  reference,
  path,
  depth,
  announced,
}: {
  reference: number;
  path: string;
  depth: number;
  announced: number | null;
}) {
  const store = useDebug();
  const children = store.children.get(reference);
  if (!children) return null;
  const more =
    children.total !== null && children.items.length < children.total;
  return (
    <>
      {children.items.map((child, index) => (
        <VariableNode
          key={`${child.name}\0${index}`}
          variable={child}
          parent={reference}
          path={`${path}/${child.name}`}
          depth={depth}
        />
      ))}
      {children.error && (
        <div
          className="debug-row debug-error"
          style={{ paddingLeft: 18 + depth * 12 }}
        >
          {children.error}
        </div>
      )}
      {children.loading && (
        <div
          className="debug-row muted"
          style={{ paddingLeft: 18 + depth * 12 }}
        >
          Loading…
        </div>
      )}
      {more && !children.loading && (
        <button
          type="button"
          className="debug-more"
          style={{ marginLeft: 18 + depth * 12 }}
          onClick={() => void loadChildren(reference, true, announced)}
        >
          Show more ({children.items.length} of {children.total})
        </button>
      )}
    </>
  );
}

/** One evaluated value with its children, for Debug Hover. */
export function ValueTree({
  name,
  value,
  path,
}: {
  name: string;
  value: { value: string; type?: string; variablesReference: number };
  path: string;
}) {
  return (
    <div role="tree" aria-label={`Value of ${name}`} className="debug-tree">
      <VariableNode
        variable={{ name, ...value }}
        parent={0}
        path={path}
        depth={0}
      />
    </div>
  );
}
