import { useEffect, useState } from "react";
import type { Command, PaletteMode } from "../../components/CommandPalette";
import { ideBackend } from "../../services/ide";
import { getDocument } from "../text-editor/documents";
import { activeProject } from "./cmake";
import { current, host, message, reveal, viewOf } from "./editors";
import { documentSymbols, serverOf, type OutlineSymbol } from "./lsp";
import { rank } from "./model";
import { baseName, join, separator } from "./paths";
import { revealInTree } from "./projects";

const SYMBOL_KINDS: Record<number, string> = {
  2: "module",
  3: "namespace",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  22: "enum member",
  23: "struct",
  26: "type parameter",
};
export const symbolKind = (kind: number) => SYMBOL_KINDS[kind] ?? "symbol";

type Loaded<T> = { items: T } | { status: string };

/**
 * The palette's IDE modes, as in VS Code: no prefix goes to a file of the IDE project used
 * last, `@` to a symbol of the code file focused last. Loaded while the palette is open.
 */
export function useQuickModes(open: boolean): PaletteMode[] {
  const [files, setFiles] = useState<Loaded<string[]>>({ status: "" });
  const [symbols, setSymbols] = useState<Loaded<OutlineSymbol[]>>({
    status: "",
  });
  const project = open ? activeProject() : null;
  const root = project?.root ?? null;
  const id = open ? current() : null;
  const path = id ? getDocument(id).path : null;
  useEffect(() => {
    if (!open) return;
    if (!root) {
      setFiles({ status: "Open a folder in the IDE to go to its files." });
      return;
    }
    let live = true;
    setFiles({ status: "Listing files…" });
    ideBackend
      .files(root)
      .then((result) => live && setFiles({ items: result.files }))
      .catch((e) => live && setFiles({ status: message(e) }));
    return () => {
      live = false;
    };
  }, [open, root]);
  useEffect(() => {
    if (!open) return;
    const view = id && viewOf(id);
    if (!view || !path) {
      setSymbols({ status: "Open a code file to go to its symbols." });
      return;
    }
    if (serverOf(path)?.status !== "ready") {
      setSymbols({ status: "No language server is ready for this file." });
      return;
    }
    let live = true;
    setSymbols({ status: "Loading symbols…" });
    documentSymbols(view)
      .then(
        (result) =>
          live &&
          setSymbols(
            result ? { items: result } : { status: "No symbols here." },
          ),
      )
      .catch((e) => live && setSymbols({ status: message(e) }));
    return () => {
      live = false;
    };
  }, [open, id, path]);
  const fileMode: PaletteMode = {
    prefix: "",
    placeholder: "Search files by name (> commands, @ symbols)",
    items(query) {
      if ("status" in files) return files.status;
      const report = (e: unknown) => host().report(e);
      return rank(query, files.items, 50).map((file): Command => ({
        id: `file:${file}`,
        label: baseName(file),
        detail: file,
        run: () => {
          const target = join(root!, file.split("/").join(separator(root!)));
          void reveal(target)
            .then(() => project && revealInTree(project.id, target))
            .catch(report);
        },
      }));
    },
  };
  const symbolMode: PaletteMode = {
    prefix: "@",
    placeholder: "Go to a symbol in the editor",
    items(query) {
      if ("status" in symbols) return symbols.status;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const list: Command[] = [];
      const visit = (items: OutlineSymbol[], container: string) => {
        for (const symbol of items) {
          if (words.every((w) => symbol.name.toLowerCase().includes(w)))
            list.push({
              id: `symbol:${list.length}:${symbol.name}`,
              label: symbol.name,
              detail: container
                ? `${symbolKind(symbol.kind)} · ${container}`
                : symbolKind(symbol.kind),
              run: () =>
                void reveal(path!, symbol.start).catch((e) => host().report(e)),
            });
          visit(symbol.children, symbol.name);
        }
      };
      visit(symbols.items, "");
      return list;
    },
  };
  return [fileMode, symbolMode];
}
