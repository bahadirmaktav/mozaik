// Puts Microsoft's current ConPTY (conpty.dll and its OpenConsole.exe host, MIT, the same
// pair Windows Terminal ships) in src-tauri/conpty for the Windows installer
// (tauri.conpty.conf.json) and beside the programs already built in src-tauri/target, for
// `tauri dev`: portable-pty loads a conpty.dll found beside mozaik.exe instead of the older
// one built into Windows, whose rendering cuts and repaints the output of full-screen
// programs (see docs/decisions/023-conpty.md). A build step, never run by the application;
// the package is pinned by version and SHA-256 and downloaded only when missing. Does
// nothing on other systems.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.25.260930003";
const PACKAGE_SHA256 =
  "02b07b349af66d801159bdf9e440d4a1ce78bb951f37fc8609731665afdae7ee";
// The x64 installer (tauri.conpty.conf.json lists these files).
const ARCH = "x64";
const FILES = [
  [`runtimes/win-${ARCH}/native/conpty.dll`, "conpty.dll"],
  // conpty.dll starts the host from the folder of its architecture beside it.
  [`build/native/runtimes/${ARCH}/OpenConsole.exe`, `${ARCH}/OpenConsole.exe`],
];

const tauri = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri");
const target = join(tauri, "conpty");
const stamp = join(target, "VERSION");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

if (process.platform !== "win32") process.exit(0);
if (
  !existsSync(stamp) ||
  readFileSync(stamp, "utf8").trim() !== `${VERSION} ${ARCH}` ||
  !FILES.every(([, to]) => existsSync(join(target, to)))
)
  await download();
for (const profile of ["debug", "release"]) {
  const built = join(tauri, "target", profile);
  if (!existsSync(built)) continue;
  for (const [, to] of FILES) {
    mkdirSync(dirname(join(built, to)), { recursive: true });
    try {
      copyFileSync(join(target, to), join(built, to));
    } catch (error) {
      // A running Mozaik keeps its conpty.dll open.
      console.warn(`${join(built, to)}: ${error.message}`);
    }
  }
}

async function download() {
  const url = `https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/${VERSION}/microsoft.windows.console.conpty.${VERSION}.nupkg`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== PACKAGE_SHA256)
    throw new Error(`The ConPTY package ${VERSION} does not match its SHA-256`);

  const work = mkdtempSync(join(tmpdir(), "mozaik-conpty-"));
  try {
    const archive = join(work, "conpty.zip");
    writeFileSync(archive, data);
    // Windows' own tar (bsdtar, not a GNU tar earlier on PATH) reads the zip format.
    execFileSync(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
      ["-xf", archive, "-C", work, ...FILES.map(([from]) => from)],
    );
    rmSync(target, { recursive: true, force: true });
    for (const [from, to] of FILES) {
      mkdirSync(dirname(join(target, to)), { recursive: true });
      copyFileSync(join(work, from), join(target, to));
    }
    writeFileSync(stamp, `${VERSION} ${ARCH}\n`);
    console.log(`ConPTY ${VERSION} (${ARCH}) is in src-tauri/conpty`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
