import { test, expect, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

// The IDE's LSP client against the real rust-analyzer, when one is found (rustup's
// component, or the one VS Code's extension ships). Playwright stands in for Tauri as in
// ide-clangd.spec.ts: it covers the client and rust-analyzer's answers, not the native
// process management (which has its own rust-analyzer test in lsp.rs).
const exe = process.platform === "win32" ? ".exe" : "";
function findAnalyzer() {
  if (spawnSync(`rust-analyzer${exe}`, ["--version"]).status === 0)
    return `rust-analyzer${exe}`;
  const extensions = join(homedir(), ".vscode", "extensions");
  if (!existsSync(extensions)) return null;
  const found = readdirSync(extensions)
    .filter((name) => name.startsWith("rust-lang.rust-analyzer-"))
    .map((name) => join(extensions, name, "server", `rust-analyzer${exe}`))
    .filter((path) => existsSync(path))
    .sort();
  return found.pop() ?? null;
}
const analyzer = findAnalyzer();
const cargo = spawnSync(`cargo${exe}`, ["--version"]).status === 0;
test.skip(!analyzer || !cargo, "rust-analyzer or cargo is not installed");

function project() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "mozaik-rust-")));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "Cargo.toml"),
    '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  writeFileSync(
    join(root, "src", "main.rs"),
    // The project's own macro: the standard library's need a toolchain rust-analyzer
    // supports, which the machine may not have.
    "mod util;\n\nmacro_rules! double {\n    ($x:expr) => {\n        $x * 2\n    };\n}\n\nfn main() {\n    let total = util::add(1, 2);\n    let _ = double!(total);\n}\n",
  );
  writeFileSync(
    join(root, "src", "util.rs"),
    "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
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
  await page.exposeFunction("__read", (path: string) => fileData(path));
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
    // As Rust starts it: rust-analyzer's own cargo calls never download.
    server = spawn(analyzer!, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CARGO_NET_OFFLINE: "true" },
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
      name: "demo",
      settings: {
        formatOnSave: false,
        tabSize: 4,
        insertSpaces: true,
        exclude: [],
      },
    });
    ide.read = (path: string) => w.__read(path);
    ide.gitStatus = async () => null;
    ide.servers = async () => [
      {
        id: "rust-analyzer",
        languages: "Rust",
        path: "rust-analyzer",
        configured: false,
      },
    ];
    ide.lspStart = async (
      _id: string,
      server: string,
      _root: string,
      onEvent: unknown,
    ) => {
      if (server !== "rust-analyzer") throw new Error(`unexpected ${server}`);
      w.__lsp = onEvent;
      await w.__start();
      return "rust-analyzer";
    };
    ide.lspSend = (_id: string, message: string) => w.__send(message);
    ide.lspStop = async () => {};
  }, root);
  return { stop: () => (server as ChildProcess | null)?.kill() };
}

test("rust-analyzer: outline, inlay hints, definition, parent module, macro expansion and diagnostics", async ({
  page,
}) => {
  test.setTimeout(180000);
  const root = project();
  const { stop } = await bridge(page, root);
  try {
    await page.keyboard.press("Control+Shift+Quote");
    await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Open Folder…" }).click();
    const browser = page.getByRole("dialog", { name: "Open Folder" });
    await browser.getByRole("combobox").fill(`${root}\\`);
    await expect(
      browser.getByRole("option", { name: /^Open / }).first(),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    const tree = page.getByRole("tree", { name: "Project files" });
    await tree.getByRole("treeitem", { name: /^src/ }).click();
    await tree.getByRole("treeitem", { name: /^main.rs/ }).click();
    const view = page.getByRole("textbox", { name: "Code main.rs" });
    await expect(
      page.locator(".outline-symbol", { hasText: "main" }),
    ).toBeVisible({ timeout: 90000 });
    await expect(page.locator(".code-status")).toContainText("rust-analyzer");

    // The inferred type of `total` and the names of add's parameters.
    await expect(
      view.locator(".cm-inlay-hint", { hasText: "i32" }),
    ).toBeVisible({ timeout: 90000 });
    await expect(
      view.locator(".cm-inlay-parameter", { hasText: "a:" }),
    ).toBeVisible();

    // Cursor into `add` of `util::add(1, 2)` on line 10 (Home goes to the indentation),
    // then to its definition.
    await view.click();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < 19; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("F12");
    const util = page.getByRole("textbox", { name: "Code util.rs" });
    await expect(util).toBeFocused({ timeout: 30000 });

    // Back to the file that declares `mod util;`, from the palette as in VS Code.
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("Locate Parent Module");
    await page.keyboard.press("Enter");
    await expect(view).toBeFocused({ timeout: 30000 });

    // double! expanded in a Rust tab of its own.
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("Expand Macro Recursively");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Code double! expansion.rs" }),
    ).toContainText("total * 2", { timeout: 30000 });
    // Not a change to save: it closes without a question.
    await expect(
      page.getByRole("tab", { name: "double! expansion.rs", exact: true }),
    ).toBeVisible();

    // rust-analyzer's own error is reported while typing, before any save.
    await page.getByRole("tab", { name: "main.rs" }).click();
    await view.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("mod missing;\n");
    await expect(page.locator(".code-editor .cm-lintRange-error")).toBeVisible({
      timeout: 60000,
    });
  } finally {
    stop();
  }
});
