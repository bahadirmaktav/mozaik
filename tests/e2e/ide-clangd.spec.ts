import { test, expect, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// The IDE's LSP client against the real clangd, when it is installed. Playwright stands in
// for Tauri: messages go through exposed functions instead of IPC, and files are read and
// written by this test process. It covers the client and clangd's answers, not the native
// process management in Rust (which has its own clangd test).
const clangd = spawnSync(
  process.platform === "win32" ? "where" : "which",
  ["clangd"],
  {
    encoding: "utf8",
  },
).stdout?.split(/\r?\n/)[0];
test.skip(!clangd, "clangd is not installed");

function project() {
  // Canonical, as Rust gives it (Windows temp paths can be 8.3 short names).
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), "mozaik-clangd-")),
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "foo.h"), "int foo(int value);\n");
  writeFileSync(
    join(root, "src", "main.cpp"),
    '#include "foo.h"\n\nint main() {\n  int total = foo(1);\n  return total;\n}\n',
  );
  return root;
}
const fileData = (path: string) => {
  const bytes = readFileSync(path);
  return {
    path,
    name: basename(path),
    text: bytes.toString("utf8").replace(/\r\n/g, "\n"),
    revision: createHash("sha256").update(bytes).digest("hex"),
    bom: false,
    ending: "lf",
  };
};

async function bridge(page: Page, root: string) {
  let server: ChildProcess | null = null;
  const saves: string[] = [];
  await page.exposeFunction("__read", (path: string) => fileData(path));
  await page.exposeFunction("__save", (request: any) => {
    if (fileData(request.path).revision !== request.revision)
      throw new Error("changed");
    writeFileSync(request.path, request.text);
    saves.push(basename(request.path));
    return fileData(request.path);
  });
  await page.exposeFunction("__list", (directory: string) =>
    readdirSync(directory).map((name) => ({
      path: join(directory, name),
      name,
      kind: statSync(join(directory, name)).isDirectory()
        ? "directory"
        : "file",
    })),
  );
  await page.exposeFunction("__start", () => {
    server = spawn(clangd!, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buffer = Buffer.alloc(0);
    server.stdout!.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const length = Number(
          /Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())![1],
        );
        if (buffer.length < end + 4 + length) return;
        const data = buffer
          .subarray(end + 4, end + 4 + length)
          .toString("utf8");
        buffer = buffer.subarray(end + 4 + length);
        void page
          .evaluate(
            (data) => (window as any).__lsp({ kind: "message", data }),
            data,
          )
          .catch(() => {});
      }
    });
  });
  await page.exposeFunction("__send", (message: string) => {
    server?.stdin!.write(
      `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
    );
  });
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(async (root) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const ide = (await import(loaded("/src/services/ide.ts"))).ideBackend;
    const fs = (await import(loaded("/src/services/filesystem.ts"))).fileSystem;
    const w = window as any;
    fs.list = async (directory: string) => ({
      directory,
      parent: null,
      crumbs: [],
      separator: "\\",
      unreadable: 0,
      fallbackFrom: null,
      entries: (await w.__list(directory)).map((e: any) => ({
        ...e,
        targetKind: null,
        hidden: false,
        size: 1,
        modified: 1,
        broken: false,
        unsupported: false,
      })),
    });
    fs.watch = async () => {};
    ide.open = async () => ({
      root,
      name: "proj",
      settings: {
        formatOnSave: false,
        tabSize: 4,
        insertSpaces: true,
        exclude: [],
      },
    });
    ide.read = (path: string) => w.__read(path);
    ide.save = (request: unknown) => w.__save(request);
    ide.gitStatus = async () => null;
    ide.servers = async () => [
      { id: "clangd", languages: "C/C++", path: "clangd", configured: false },
    ];
    ide.lspStart = async (
      _id: string,
      _server: string,
      _root: string,
      onEvent: unknown,
    ) => {
      w.__lsp = onEvent;
      await w.__start();
      return "clangd";
    };
    ide.lspSend = (_id: string, message: string) => w.__send(message);
    ide.lspStop = async () => {};
  }, root);
  return { saves, stop: () => (server as ChildProcess | null)?.kill() };
}

test("clangd: diagnostics, outline, definition and a rename across files", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = project();
  const { saves, stop } = await bridge(page, root);
  try {
    // The compiler warnings of Settings, for this project without a compilation database.
    await page.evaluate(async () => {
      const url =
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((u) => new URL(u).pathname === "/src/services/analysis.ts") ??
        "/src/services/analysis.ts";
      const { analysisBackend } = await import(url);
      analysisBackend.info = async () => ({
        settings: { warningFlags: "-Wall -Wextra" },
      });
    });
    await page.keyboard.press("Control+Shift+Quote");
    await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Open Folder…" }).click();
    const tree = page.getByRole("tree", { name: "Project files" });
    await tree.getByRole("treeitem", { name: /^src/ }).click();
    await tree.getByRole("treeitem", { name: /^main.cpp/ }).click();
    const view = page.getByRole("textbox", { name: "Code main.cpp" });
    await expect(
      page.locator(".outline-symbol", { hasText: "main" }),
    ).toBeVisible({ timeout: 30000 });

    await view.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("int broken = bogus;\n");
    await expect(page.locator(".ide-status-problems")).toContainText("⊗ 1", {
      timeout: 30000,
    });
    await expect(
      page.locator(".code-editor .cm-lintRange-error"),
    ).toBeVisible();
    // clangd's semantic tokens color names by what they are.
    await expect(view.locator(".cm-sem-function").first()).toBeVisible({
      timeout: 30000,
    });
    // With -Wall an unused variable is reported.
    await page.keyboard.type("void probe() { int unused_value = 3; }\n");
    await expect(
      page.locator(".code-editor .cm-lintRange-warning").first(),
    ).toBeVisible({ timeout: 30000 });

    // Cursor into `foo` of `foo(1)` on line 4.
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("F12");
    const header = page.getByRole("textbox", { name: "Code foo.h" });
    await expect(header).toBeFocused({ timeout: 20000 });
    // clangd finds foo.h's own occurrences for a rename only once it has parsed foo.h
    // (its semantic tokens show that); on a slow machine F2 could come sooner.
    await expect(header.locator(".cm-sem-function").first()).toBeVisible({
      timeout: 30000,
    });
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(view).toBeFocused();

    await page.keyboard.press("F2");
    const name = page.getByRole("textbox", { name: "New name" });
    await expect(name).toHaveValue("foo");
    await name.fill("compute");
    await page.keyboard.press("Enter");
    // foo.h is open as well now, so clangd's edit changes both editors and writes nothing.
    await expect(view).toContainText("compute(1)", { timeout: 20000 });
    await page.getByRole("tab", { name: "foo.h •" }).click();
    await expect(header).toContainText("int compute(int value);");
    expect(saves).toEqual([]);
  } finally {
    stop();
  }
});
