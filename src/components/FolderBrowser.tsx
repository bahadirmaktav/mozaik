import { useEffect, useRef, useState } from "react";
import { fileSystem, isDirectory } from "../services/filesystem";
import { splitQuery, type FolderRow } from "./folderBrowserModel";

/**
 * A folder chosen by typing its path in the palette, as VS Code's simple file dialog: the
 * typed folder's subfolders complete the path (Tab or Enter goes into one, Backspace edits),
 * and Enter on the first entry chooses the folder. Only folders are listed; nothing is opened
 * or written here.
 */
export function FolderBrowser({
  title,
  start,
  onPick,
  onCancel,
}: {
  title: string;
  /** The folder shown first; null is the home folder. */
  start: string | null;
  onPick: (folder: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null),
    [separator, setSeparator] = useState("/"),
    [home, setHome] = useState(""),
    [listing, setListing] = useState<{
      directory: string;
      folders: string[];
      error: string | null;
    } | null>(null),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  // The start folder, else home (a start folder that is gone shows its nearest ancestor).
  useEffect(() => {
    let live = true;
    void Promise.all([
      fileSystem.list(start, true).catch(() => fileSystem.list(null)),
      fileSystem.list(null).catch(() => null),
    ]).then(
      ([first, homeListing]) => {
        if (!live) return;
        setSeparator(first.separator);
        setHome(homeListing?.directory ?? "");
        setQuery(
          first.directory
            ? withSeparator(first.directory, first.separator)
            : "",
        );
      },
      () => live && setQuery(""),
    );
    return () => {
      live = false;
    };
  }, [start]);
  const parts = query === null ? null : splitQuery(query, separator, home);
  // Lists the typed folder; answers for an older folder are dropped.
  const directory = parts?.directory ?? null;
  useEffect(() => {
    if (directory === null) return;
    let live = true;
    void fileSystem.list(trimSeparator(directory, separator)).then(
      (l) =>
        live &&
        setListing({
          directory,
          folders: l.entries
            .filter((e) => isDirectory(e) && !e.unsupported)
            .map((e) => e.name)
            .sort((a, b) =>
              a.localeCompare(b, undefined, { sensitivity: "base" }),
            ),
          error: null,
        }),
      (e) =>
        live &&
        setListing({
          directory,
          folders: [],
          error: e instanceof Error ? e.message : String(e),
        }),
    );
    return () => {
      live = false;
    };
  }, [directory, separator]);
  const ready = parts && listing?.directory === parts.directory;
  const rows: FolderRow[] = [];
  if (parts && ready && !listing.error) {
    const name = parts.name.toLowerCase();
    const folders = listing.folders.filter((f) =>
      f.toLowerCase().startsWith(name),
    );
    // Then the folders that only contain what was typed.
    const more = name
      ? listing.folders.filter(
          (f) =>
            !f.toLowerCase().startsWith(name) && f.toLowerCase().includes(name),
        )
      : [];
    const exact = listing.folders.find((f) => f.toLowerCase() === name);
    const chosen = exact ? parts.directory + exact : parts.directory;
    rows.push({ kind: "choose", path: trimSeparator(chosen, separator) });
    if (!name && parentOf(parts.directory, separator))
      rows.push({
        kind: "parent",
        path: parentOf(parts.directory, separator)!,
      });
    for (const f of [...folders, ...more])
      rows.push({ kind: "folder", path: parts.directory + f, name: f });
  }
  // Typing a name selects the first folder it matches; an empty name the folder itself.
  const current = Math.max(0, Math.min(selected, rows.length - 1));
  function enter(row: FolderRow) {
    if (row.kind === "choose") return onPick(row.path);
    const next = withSeparator(row.path, separator);
    setQuery(next);
    setSelected(0);
  }
  useEffect(() => {
    document
      .getElementById(`folder-${current}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current, query]);
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onPointerDown={(event) => {
        if (event.target === ref.current) onCancel();
      }}
    >
      <input
        ref={input}
        className="palette-search"
        autoFocus
        spellCheck={false}
        placeholder={title}
        aria-label={`${title}: folder path`}
        role="combobox"
        aria-expanded="true"
        aria-controls="folder-results"
        aria-activedescendant={rows[current] ? `folder-${current}` : undefined}
        value={query ?? ""}
        onChange={(e) => {
          setQuery(e.target.value);
          // A typed name selects its first folder; a bare folder path the folder itself.
          setSelected(splitQuery(e.target.value, separator, home).name ? 1 : 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!rows.length) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setSelected((current + step + rows.length) % rows.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (rows[current]) enter(rows[current]);
          } else if (e.key === "Tab" && !e.shiftKey) {
            // Tab completes the selected folder's name, as a shell does.
            e.preventDefault();
            const row =
              rows[current]?.kind === "choose" ? rows[1] : rows[current];
            if (row && row.kind !== "choose") enter(row);
          }
        }}
      />
      <ul id="folder-results" className="palette-results" role="listbox">
        {rows.map((row, index) => (
          <li
            key={`${row.kind}:${row.path}`}
            id={`folder-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setSelected(index)}
            onClick={() => {
              enter(row);
              input.current?.focus();
            }}
          >
            <span>
              {row.kind === "choose"
                ? `Open ${baseName(row.path, separator)}`
                : row.kind === "parent"
                  ? ".."
                  : row.name}
            </span>
            <span className="palette-detail" title={row.path}>
              {row.kind === "choose"
                ? row.path
                : row.kind === "parent"
                  ? "parent folder"
                  : ""}
            </span>
          </li>
        ))}
        {query !== null && ready && listing.error && (
          <li className="muted">{listing.error}</li>
        )}
        {(query === null || !ready) && <li className="muted">Reading…</li>}
      </ul>
    </dialog>
  );
}

function withSeparator(path: string, separator: string) {
  return path.endsWith(separator) || path.endsWith("/")
    ? path
    : path + separator;
}
function trimSeparator(path: string, separator: string) {
  // A drive (`C:\`) or `/` keeps its separator.
  if (/^[A-Za-z]:[\\/]$/.test(path) || path === "/") return path;
  return path.replace(/[\\/]+$/, "") || separator;
}
function parentOf(directory: string, separator: string) {
  const trimmed = trimSeparator(directory, separator);
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed) || trimmed === "/") return null;
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (index < 0) return null;
  return withSeparator(trimmed.slice(0, index) || "/", separator);
}
function baseName(path: string, separator: string) {
  const trimmed = trimSeparator(path, separator);
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed;
}
