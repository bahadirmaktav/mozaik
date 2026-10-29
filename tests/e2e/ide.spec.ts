import { test, expect, type Page } from "@playwright/test";

// Browser runs have no native backend. This replaces the typed IDE and filesystem adapters
// with an in-memory C++ project, a fake Git status and a small fake language server that
// speaks LSP JSON-RPC, so it covers the IDE panels and the LSP client wiring, not native
// processes, clangd itself or disk writes.
async function start(
  page: Page,
  options: { server?: boolean; recent?: boolean } = {},
) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(async ({ server, recent }) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const ide = (await import(loaded("/src/services/ide.ts"))).ideBackend;
    const fs = (await import(loaded("/src/services/filesystem.ts"))).fileSystem;
    let revision = 0;
    const disk = new Map<string, { text: string; revision: string }>();
    const folders = new Set(["/proj", "/proj/src", "/proj/inc", "/proj/build"]);
    const write = (path: string, text: string) =>
      disk.set(path, { text, revision: `r${revision++}` });
    write(
      "/proj/src/main.cpp",
      '#include "foo.h"\n\nint main() {\n  int total = foo(1);\n  return total;\n}\n',
    );
    write(
      "/proj/src/util.cpp",
      '#include "foo.h"\n\nint twice() { return foo(2); }\n',
    );
    write("/proj/inc/foo.h", "int foo(int value);\n");
    write("/proj/README.md", "# Demo\n");
    const fake = {
      disk,
      saves: [] as string[],
      sent: [] as string[],
      head: new Map([["/proj/src/main.cpp", "int main() {\n  return 0;\n}\n"]]),
    };
    (window as any).__ide = fake;
    const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
    const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    const data = (path: string) => {
      const file = disk.get(path);
      if (!file) throw new Error("File is missing or inaccessible");
      return {
        path,
        name: name(path),
        text: file.text,
        revision: file.revision,
        bom: false,
        ending: "lf",
      };
    };
    fs.list = async (directory: string) => ({
      directory,
      parent: parent(directory),
      crumbs: [],
      separator: "/",
      unreadable: 0,
      fallbackFrom: null,
      entries: [...folders, ...disk.keys()]
        .filter((p) => p !== directory && parent(p) === directory)
        .map((p) => ({
          path: p,
          name: name(p),
          kind: folders.has(p) ? "directory" : "file",
          targetKind: null,
          hidden: false,
          size: 1,
          modified: 1,
          broken: false,
          unsupported: false,
        })),
    });
    fs.watch = async () => {};
    fs.create = async (dir: string, file: string, directory: boolean) => {
      const path = `${dir}/${file}`;
      if (directory) folders.add(path);
      else write(path, "");
      return { path, name: file, kind: directory ? "directory" : "file" };
    };
    fs.rename = async (path: string, newName: string) => {
      const target = `${parent(path)}/${newName}`;
      disk.set(target, disk.get(path)!);
      disk.delete(path);
      return { path: target, name: newName, kind: "file" };
    };
    fs.trash = async (paths: string[]) => {
      paths.forEach((p) => disk.delete(p));
      return [];
    };
    fs.plan = async (sources: string[], destination: string) => ({
      conflicts: sources
        .filter((s) => disk.has(`${destination}/${name(s)}`))
        .map((s) => ({ source: s, name: name(s) })),
    });
    fs.transfer = async (request: any) => {
      for (const source of request.sources) {
        disk.set(`${request.destination}/${name(source)}`, disk.get(source)!);
        disk.delete(source);
      }
      return {
        completed: request.sources,
        skipped: 0,
        failed: [],
        cancelled: false,
      };
    };
    ide.open = async () => ({
      root: "/proj",
      name: "proj",
      settings: {
        formatOnSave: false,
        tabSize: 4,
        insertSpaces: true,
        exclude: [],
      },
    });
    ide.read = async (path: string) => data(path);
    ide.save = async (request: any) => {
      const current = disk.get(request.path);
      if (current?.revision !== request.revision)
        throw new Error("The file changed on disk.");
      fake.saves.push(request.path);
      write(request.path, request.text);
      return data(request.path);
    };
    ide.files = async () => ({
      files: [...disk.keys()].map((p) => p.slice(6)).sort(),
      truncated: false,
    });
    const find = (text: string, query: any) => {
      const matches = [];
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        let from = 0;
        for (;;) {
          const hay = query.matchCase ? lines[i] : lines[i].toLowerCase();
          const needle = query.matchCase
            ? query.text
            : query.text.toLowerCase();
          const at = hay.indexOf(needle, from);
          if (at < 0) break;
          matches.push({
            line: i + 1,
            column: at,
            length: needle.length,
            preview: lines[i],
            offset: at,
          });
          from = at + needle.length;
        }
      }
      return matches;
    };
    ide.search = async (_root: string, query: any) => ({
      files: [...disk]
        .map(([path, file]) => ({
          path,
          relative: path.slice(6),
          revision: file.revision,
          matches: find(file.text, query),
        }))
        .filter((f) => f.matches.length),
      truncated: false,
      skipped: 0,
    });
    const replaceText = (text: string, query: any, replacement: string) =>
      text.split(query.text).join(replacement);
    ide.replaceText = async (text: string, query: any, replacement: string) =>
      replaceText(text, query, replacement);
    ide.replace = async (
      _root: string,
      query: any,
      replacement: string,
      targets: any[],
    ) =>
      targets.map((t) => {
        const file = disk.get(t.path)!;
        if (file.revision !== t.revision)
          return { path: t.path, error: "changed", file: null };
        write(t.path, replaceText(file.text, query, replacement));
        fake.saves.push(t.path);
        return { path: t.path, error: null, file: data(t.path) };
      });
    ide.setSettings = async (_root: string, settings: any) => settings;
    ide.gitStatus = async () => ({
      root: "/proj",
      branch: "main",
      changes: [
        { path: "/proj/src/main.cpp", status: "M" },
        { path: "/proj/README.md", status: "U" },
      ],
      ignored: ["/proj/build"],
    });
    ide.recent = async () => (recent ? "/proj" : null);
    ide.headText = async (path: string) => fake.head.get(path) ?? null;
    ide.servers = async () => [
      {
        id: "clangd",
        languages: "C/C++",
        path: server ? "/usr/bin/clangd" : null,
        configured: false,
      },
    ];

    // A tiny language server over the same JSON-RPC messages clangd would exchange.
    const texts = new Map<string, string>();
    let emit: (event: any) => void = () => {};
    const send = (message: any) =>
      setTimeout(
        () =>
          emit({
            kind: "message",
            data: JSON.stringify({ jsonrpc: "2.0", ...message }),
          }),
        5,
      );
    const uri = (path: string) => `file://${path}`;
    const range = (line: number, start: number, end: number) => ({
      start: { line, character: start },
      end: { line, character: end },
    });
    const at = (text: string, word: string) => {
      const lines = text.split("\n");
      const line = lines.findIndex((l) => l.includes(word));
      return range(
        line,
        lines[line].indexOf(word),
        lines[line].indexOf(word) + word.length,
      );
    };
    // The symbol foo where it is called or declared (not in the include line).
    const symbol = (text: string) => {
      const found = at(text, "foo(");
      return {
        ...found,
        end: { ...found.end, character: found.end.character - 1 },
      };
    };
    const diagnose = (doc: string) => {
      const text = texts.get(doc)!;
      send({
        method: "textDocument/publishDiagnostics",
        params: {
          uri: doc,
          diagnostics: text.includes("bogus")
            ? [
                {
                  range: at(text, "bogus"),
                  severity: 1,
                  message: "use of undeclared identifier 'bogus'",
                  source: "clang",
                },
              ]
            : [],
        },
      });
    };
    const textOf = (doc: string) =>
      texts.get(doc) ?? disk.get(doc.slice(7))?.text ?? "";
    ide.lspStart = async (
      _id: string,
      _server: string,
      _root: string,
      onEvent: any,
    ) => {
      emit = onEvent;
      return "/usr/bin/clangd";
    };
    ide.lspStop = async () => {};
    ide.lspSend = async (_id: string, raw: string) => {
      const message = JSON.parse(raw);
      fake.sent.push(message.method ?? "response");
      const { id, method, params } = message;
      const reply = (result: unknown) => send({ id, result });
      if (method === "initialize")
        reply({
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ["."] },
            hoverProvider: true,
            definitionProvider: true,
            implementationProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            codeActionProvider: true,
            documentFormattingProvider: true,
            documentSymbolProvider: true,
          },
        });
      else if (method === "textDocument/didOpen") {
        texts.set(params.textDocument.uri, params.textDocument.text);
        diagnose(params.textDocument.uri);
      } else if (method === "textDocument/didChange") {
        texts.set(params.textDocument.uri, params.contentChanges.at(-1).text);
        diagnose(params.textDocument.uri);
      } else if (method === "textDocument/completion")
        reply({
          isIncomplete: false,
          items: [{ label: "fooBarBaz", kind: 3, insertText: "fooBarBaz" }],
        });
      else if (method === "textDocument/definition")
        reply([
          {
            uri: uri("/proj/inc/foo.h"),
            range: symbol(textOf(uri("/proj/inc/foo.h"))),
          },
        ]);
      else if (method === "textDocument/references")
        reply(
          ["/proj/src/main.cpp", "/proj/src/util.cpp", "/proj/inc/foo.h"].map(
            (p) => ({
              uri: uri(p),
              range: symbol(textOf(uri(p))),
            }),
          ),
        );
      else if (method === "textDocument/implementation") reply([]);
      else if (method === "textDocument/documentSymbol")
        reply([
          {
            name: "main",
            detail: "int ()",
            kind: 12,
            range: range(2, 0, 5),
            selectionRange: range(2, 4, 8),
            children: [],
          },
          {
            name: "Widget",
            kind: 23,
            range: range(6, 0, 6),
            selectionRange: range(6, 0, 6),
            children: [
              {
                name: "draw",
                kind: 6,
                range: range(6, 0, 6),
                selectionRange: range(6, 0, 6),
              },
            ],
          },
        ]);
      else if (method === "textDocument/prepareRename") {
        const text = textOf(params.textDocument.uri);
        reply({ range: symbol(text), placeholder: "foo" });
      } else if (method === "textDocument/rename")
        reply({
          changes: Object.fromEntries(
            ["/proj/src/main.cpp", "/proj/src/util.cpp", "/proj/inc/foo.h"].map(
              (p) => [
                uri(p),
                [{ range: symbol(textOf(uri(p))), newText: params.newName }],
              ],
            ),
          ),
        });
      else if (method === "textDocument/codeAction") {
        const doc = params.textDocument.uri;
        reply(
          params.context.diagnostics.length
            ? [
                {
                  title: "Replace 'bogus' with 'total'",
                  kind: "quickfix",
                  isPreferred: true,
                  edit: {
                    changes: {
                      [doc]: [
                        { range: at(textOf(doc), "bogus"), newText: "total" },
                      ],
                    },
                  },
                },
              ]
            : [],
        );
      } else if (method === "textDocument/formatting") {
        const text = textOf(params.textDocument.uri);
        reply(
          text.includes("int  ")
            ? [{ range: at(text, "int  "), newText: "int " }]
            : [],
        );
      } else if (method === "shutdown") reply(null);
      else if (id !== undefined && method) reply(null);
    };
  }, options);
}
const fake = (page: Page) => page.evaluate(() => (window as any).__ide);
const onDisk = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__ide.disk.has(p), path);
const diskText = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__ide.disk.get(p)?.text, path);
async function openProject(page: Page) {
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Open Folder…" }).click();
  await expect(tree(page).getByRole("treeitem", { name: /src/ })).toBeVisible();
}
const tree = (page: Page) => page.getByRole("tree", { name: "Project files" });
const code = (page: Page, name: string) =>
  page.getByRole("textbox", { name: `Code ${name}` });
async function openFile(page: Page, folder: string, file: string) {
  const row = tree(page).getByRole("treeitem", {
    name: new RegExp(`^${folder}`),
  });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await tree(page)
    .getByRole("treeitem", { name: new RegExp(`^${file}`) })
    .click();
  await expect(code(page, file)).toBeVisible();
}
async function codeMenu(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Code actions" }).first().click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("the launcher offers the IDE as one module with Problems and Terminal views", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("ControlRight+k");
  const search = page.getByRole("combobox", { name: "Search tools" });
  await search.fill("code");
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("problems");
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("ide");
  await expect(page.getByRole("option")).toHaveText(["IDE"]);
  await page.keyboard.press("Enter");
  // Sidebar, an empty code editor, the bottom panel and the status bar.
  await expect(page.locator("[data-panel]")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Open Folder…" }),
  ).toBeFocused();
  await expect(page.locator(".code-editor")).toBeVisible();
  await expect(page.locator(".ide-status-problems")).toContainText("⊗ 0");
  // The docked parts have their own bars: no tab strip, no close or maximize.
  await expect(page.locator(".panel.docked")).toHaveCount(3);
  await expect(page.locator(".panel.docked .panel-header")).toHaveCount(0);
  await expect(page.locator(".project-header")).toHaveText(/Explorer/);
  const bottom = (await page.locator(".ide-status").boundingBox())!;
  const area = (await page.locator(".workspace-area").boundingBox())!;
  expect(bottom.height).toBeLessThan(30);
  expect(bottom.x).toBeLessThan(area.x + 2);
  expect(bottom.y + bottom.height).toBeGreaterThan(area.y + area.height - 2);
  // Minimized, the bottom panel keeps its bar and the sidebar its activity bar.
  await page.getByRole("button", { name: "Minimize panel" }).click();
  await expect(page.locator(".ide-panel")).toHaveCSS("height", "30px");
  await page.getByRole("button", { name: "Minimize sidebar" }).click();
  expect((await page.locator(".project").boundingBox())!.width).toBe(40);
  await expect(page.locator(".project-main")).toHaveCount(0);
  await page.getByRole("tab", { name: "Search" }).click();
  await expect(page.locator(".project-header")).toHaveText(/Search/);
  // The shown view's icon minimizes again; another view's restores.
  await page.getByRole("tab", { name: "Search" }).click();
  await expect(page.locator(".project-main")).toHaveCount(0);
  await page.getByRole("tab", { name: "Explorer" }).click();
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.locator(".ide-panel .terminal-wrapper")).toBeVisible();
  // Outside the desktop app the shell cannot start; the panel offers a new one.
  await expect(
    page.getByRole("button", { name: "Restart Terminal" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Problems" }).click();
  await expect(page.locator(".problems")).toBeVisible();
  // Closing any part closes the whole IDE; the code editor stays.
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Close IDE" }).click();
  await expect(page.locator(".panel.docked")).toHaveCount(0);
  await expect(page.locator(".code-editor")).toBeVisible();
});

test("the first IDE reopens the last folder; Source Control lists changes", async ({
  page,
}) => {
  await start(page, { recent: true });
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
  await page.keyboard.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: /src/ })).toBeVisible();
  await expect(page.locator(".project-root")).toHaveText("proj");
  // What Git ignores is dimmed.
  await expect(
    tree(page).getByRole("treeitem", { name: /^build/ }),
  ).toHaveClass(/git-ignored/);
  await expect(
    tree(page).getByRole("treeitem", { name: /^src/ }),
  ).not.toHaveClass(/git-ignored/);
  await page.getByRole("tab", { name: "Source Control" }).click();
  const changes = page.getByRole("list", { name: "Changes" });
  await expect(changes.getByRole("button")).toHaveCount(2);
  await changes.getByRole("button", { name: /main\.cpp/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Committed version" }),
  ).toBeVisible();
  // An untracked file has nothing to compare with: it opens, replacing the empty editor.
  await changes.getByRole("button", { name: /README/ }).click();
  await expect(code(page, "README.md")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
});

test("a project opens beside its code editor with the editing basics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await openProject(page);
  // The branch is in the status bar only.
  await expect(page.locator(".project")).not.toContainText("main");
  // Git states: a modified file inside src, and an untracked file.
  await expect(
    tree(page).getByRole("treeitem", { name: /^src/ }),
  ).toContainText("•");
  await expect(
    tree(page).getByRole("treeitem", { name: /README/ }),
  ).toHaveClass(/git-U/);
  await openFile(page, "src", "main.cpp");
  await expect(
    tree(page).getByRole("treeitem", { name: /main.cpp/ }),
  ).toHaveClass(/git-M/);
  const sidebar = await page.locator(".project").boundingBox();
  const editor = await page.locator(".code-editor").boundingBox();
  expect(sidebar!.x).toBeLessThan(editor!.x);
  expect(sidebar!.width).toBeLessThan(editor!.width / 2);
  // The bottom panel sits under the code, not under the sidebar; the status bar under all.
  const panel = (await page.locator(".ide-panel").boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  expect(panel.y).toBeGreaterThan(editor!.y + editor!.height - 1);
  const status = (await page.locator(".ide-status").boundingBox())!;
  expect(status.y).toBeGreaterThan(panel.y + panel.height - 1);
  expect(status.x).toBeLessThanOrEqual(sidebar!.x);
  await expect(page.locator(".ide-status-branch")).toHaveText("⎇ main");
  // The file took the place of the empty editor the IDE opened with.
  await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
  await expect(page.locator(".code-editor .cm-foldGutter")).toBeVisible();
  await expect(
    page
      .locator(
        ".code-editor .cm-content .ͼ1, .code-editor .cm-content span[class^='ͼ']",
      )
      .first(),
  ).toBeVisible();

  // Multiple cursors: select the word, add its next occurrence, type over both.
  const view = code(page, "main.cpp");
  await view.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+d");
  await page.keyboard.type("sum");
  // The word at the cursor and its next occurrence (in the include) changed together.
  await expect(view).toContainText("int total = sum(1);");
  await expect(view).toContainText('#include "sum.h"');
  // Unsaved changes show on the tab and in the explorer.
  await expect(page.getByRole("tab", { name: "main.cpp •" })).toBeVisible();
  await expect(tree(page).getByLabel("Unsaved changes")).toBeVisible();
  // Bracket matching and folding.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(page.locator(".code-editor .cm-matchingBracket")).toHaveCount(2);
  await page
    .locator(".code-editor .cm-foldGutter [title='Fold line']")
    .nth(0)
    .click();
  await expect(view).not.toContainText("return total;");
  await page.locator(".code-editor .cm-foldPlaceholder").click();
  await expect(view).toContainText("return total;");
  // Closing asks before discarding.
  await page.keyboard.press("Control+w");
  await expect(
    page.getByRole("dialog", { name: "Unsaved changes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(view).toBeVisible();
  expect(errors).toEqual([]);
});

test("files open to the side, and quick open finds files", async ({ page }) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the Side" }).click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await expect(code(page, "main.cpp")).toBeVisible();
  const left = await code(page, "main.cpp").boundingBox(),
    right = await code(page, "util.cpp").boundingBox();
  expect(left!.x).toBeLessThan(right!.x);

  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Go to File…" }).click();
  await page.getByRole("combobox", { name: "File name" }).fill("fooh");
  await expect(page.getByRole("option").first()).toContainText("inc/foo.h");
  await page.keyboard.press("Enter");
  await expect(code(page, "foo.h")).toBeVisible();
  await expect(
    tree(page).getByRole("treeitem", { name: /^foo.h/ }),
  ).toHaveAttribute("aria-selected", "true");
});

test("project search finds matches and replace keeps open files unsaved", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("textbox", { name: "Search in project" }).fill("foo(");
  await page.keyboard.press("Enter");
  await expect(page.locator(".results-title").first()).toContainText(
    "3 results in 3 files",
  );
  await page.locator(".results-match", { hasText: "twice" }).click();
  await expect(code(page, "util.cpp")).toBeFocused();

  await page.getByRole("textbox", { name: "Replace with" }).fill("bar(");
  await page.getByRole("button", { name: "Replace All" }).click();
  await expect(
    page.getByRole("dialog", { name: "Replace in project" }),
  ).toContainText("1 closed file is saved directly; 2 open files");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(code(page, "util.cpp")).toContainText("return bar(2)");
  // Only the closed header was written; open files wait for an explicit save.
  expect((await fake(page)).saves).toEqual(["/proj/inc/foo.h"]);
  expect(await diskText(page, "/proj/inc/foo.h")).toContain(
    "int bar(int value);",
  );
  expect(await diskText(page, "/proj/src/util.cpp")).toContain("foo(2)");
  await expect(page.getByRole("tab", { name: "util.cpp •" })).toBeVisible();
});

test("language features: completion, diagnostics, outline, navigation and back", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const view = code(page, "main.cpp");

  // Outline from document symbols; clicking jumps.
  await expect(
    page.locator(".outline-symbol", { hasText: "Widget" }),
  ).toBeVisible();
  await page.locator(".outline-symbol", { hasText: "main" }).click();
  await expect(view).toBeFocused();

  // Completion from the server.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nfooB");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "fooBarBaz",
  );
  // CodeMirror ignores Enter in the first 75 ms after the list opens (accidental accepts).
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(view).toContainText("fooBarBaz");

  // A diagnostic is marked in the editor and listed in Problems; a quick fix repairs it.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint x = bogus;");
  await expect(page.locator(".code-editor .cm-lintRange-error")).toBeVisible();
  await expect(page.locator(".ide-status-problems")).toContainText("⊗ 1");
  await page.locator(".ide-status-problems").click();
  const problem = page.locator(".problem", {
    hasText: "undeclared identifier",
  });
  await expect(problem).toBeVisible();
  // The bottom panel sits under the code editor, never under the project sidebar.
  const problems = (await page.locator(".problems").boundingBox())!,
    sidebar = (await page.locator(".project").boundingBox())!,
    editor = (await page.locator(".code-editor").boundingBox())!;
  expect(problems.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(problems.y).toBeGreaterThan(editor.y + editor.height - 1);
  await problem.click();
  await expect(view).toBeFocused();
  await codeMenu(page, "Quick Fix…");
  await page
    .getByRole("menuitem", { name: "Replace 'bogus' with 'total'" })
    .click();
  await expect(view).toContainText("int x = total;");
  await expect(page.locator(".problem")).toHaveCount(0);

  // Go to definition opens the header; Back returns to the call.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("F12");
  await expect(code(page, "foo.h")).toBeFocused();
  await page.getByRole("button", { name: "Back" }).first().click();
  await expect(view).toBeFocused();
  await page.getByRole("button", { name: "Forward" }).first().click();
  await expect(code(page, "foo.h")).toBeFocused();

  // References are listed in the sidebar, including files that are not open.
  await page.getByRole("tab", { name: /main.cpp/ }).click();
  await view.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Shift+F12");
  await expect(page.locator(".results-title")).toContainText("References to");
  await expect(page.locator(".results-file")).toHaveCount(3);
  await page.locator(".results-match", { hasText: "twice" }).click();
  await expect(code(page, "util.cpp")).toBeFocused();
});

test("rename asks before changing closed files and format applies server edits", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const view = code(page, "main.cpp");
  await view.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("F2");
  const name = page.getByRole("textbox", { name: "New name" });
  await expect(name).toHaveValue("foo");
  await name.fill("compute");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename to compute" });
  await expect(dialog).toContainText(
    "2 files that are not open (util.cpp, foo.h)",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(view).toContainText("foo(1)");
  expect((await fake(page)).saves).toEqual([]);

  await page.keyboard.press("F2");
  await name.fill("compute");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(view).toContainText("compute(1)");
  await expect(page.getByRole("tab", { name: "main.cpp •" })).toBeVisible();
  expect((await fake(page)).saves.sort()).toEqual([
    "/proj/inc/foo.h",
    "/proj/src/util.cpp",
  ]);
  expect(await diskText(page, "/proj/src/util.cpp")).toContain("compute(2)");

  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint  spaced = 1;");
  await codeMenu(page, "Format Document");
  await expect(view).toContainText("int spaced = 1;");

  // Format on save is a project setting; it formats before the (here unavailable) write.
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Project Settings…" }).click();
  await page.getByRole("checkbox", { name: /Format on save/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await view.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint  again = 2;");
  await page.keyboard.press("Control+s");
  await expect(view).toContainText("int again = 2;");
});

test("changes open as a read-only diff and editing works without a language server", async ({
  page,
}) => {
  await start(page, { server: false });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd unavailable");
  const view = code(page, "main.cpp");
  await view.click();
  await page.keyboard.type("// still editable\n");
  await expect(view).toContainText("// still editable");
  await codeMenu(page, "Open Changes");
  await expect(
    page.getByRole("tab", { name: "main.cpp (changes)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Committed version" }),
  ).toContainText("return 0;");
  await expect(
    page.getByRole("textbox", { name: "Current version" }),
  ).toContainText("// still editable");
  await expect(
    page.getByRole("textbox", { name: "Current version" }),
  ).toHaveAttribute("contenteditable", "false");
});

test("explorer creates, renames and trashes files after confirmation", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  // No toolbar buttons: creating a file goes through the folder's context menu.
  await tree(page)
    .getByRole("treeitem", { name: /^src/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File…" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("extra.cpp");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(code(page, "extra.cpp")).toBeVisible();
  expect(await onDisk(page, "/proj/src/extra.cpp")).toBe(true);

  await tree(page)
    .getByRole("treeitem", { name: /^extra.cpp/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("renamed.cpp");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(
    tree(page).getByRole("treeitem", { name: /^renamed.cpp/ }),
  ).toBeVisible();
  // The open tab follows the file.
  await expect(page.getByRole("tab", { name: /renamed.cpp/ })).toBeVisible();

  await tree(page)
    .getByRole("treeitem", { name: /^renamed.cpp/ })
    .click();
  await tree(page)
    .getByRole("treeitem", { name: /^renamed.cpp/ })
    .press("Delete");
  await expect(
    page.getByRole("dialog", { name: "Move to Trash" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await onDisk(page, "/proj/src/renamed.cpp")).toBe(true);
  await tree(page)
    .getByRole("treeitem", { name: /^renamed.cpp/ })
    .press("Delete");
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(
    tree(page).getByRole("treeitem", { name: /^renamed.cpp/ }),
  ).toHaveCount(0);

  // Dragging a file onto a folder moves it; its open tab follows.
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await tree(page).getByRole("treeitem", { name: /^inc/ }).click();
  const source = await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .boundingBox();
  const target = await tree(page)
    .getByRole("treeitem", { name: /^inc/ })
    .boundingBox();
  await page.mouse.move(source!.x + 30, source!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + 30, target!.y + 12, { steps: 6 });
  await expect(tree(page).getByRole("treeitem", { name: /^inc/ })).toHaveClass(
    /drop-target/,
  );
  await page.mouse.up();
  await expect.poll(() => onDisk(page, "/proj/inc/util.cpp")).toBe(true);
  expect(await onDisk(page, "/proj/src/util.cpp")).toBe(false);
  await code(page, "util.cpp").click();
  expect(
    await page.evaluate(async () => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const docs = await import(
        loaded("/src/plugins/text-editor/documents.ts")
      );
      return docs.allDocuments().map((d: { path: string }) => d.path);
    }),
  ).toContain("/proj/inc/util.cpp");
});
