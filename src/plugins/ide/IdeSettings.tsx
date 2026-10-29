import { useEffect, useState } from "react";
import { ideBackend, type ServerInfo } from "../../services/ide";
import type { CMakeSettings } from "../../services/cmake";
import {
  chooseProgram,
  loadKits,
  loadSettings,
  saveCMakeSettings,
  useCMakeStore,
} from "./cmake";
import { message } from "./editors";
import { restart, serverInfo } from "./lsp";
import { allProjects } from "./projects";

/** Workspace Settings → IDE: the language server and CMake, for every project. */
export function IdeSettings() {
  const [error, setError] = useState("");
  const fail = (e: unknown) => setError(message(e));
  return (
    <>
      <Clangd onError={fail} />
      <CMake onError={fail} />
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Clangd({ onError }: { onError: (e: unknown) => void }) {
  const [clangd, setClangd] = useState<ServerInfo | null | undefined>();
  useEffect(() => {
    serverInfo(true)
      .then((list) => setClangd(list.find((s) => s.id === "clangd") ?? null))
      .catch(onError);
  }, []);
  async function choose(reset: boolean) {
    const info = reset
      ? await ideBackend.resetServer("clangd")
      : await ideBackend.chooseServer("clangd");
    if (!info) return;
    setClangd(info);
    for (const project of allProjects())
      if (project.root) restart(project.root);
  }
  return (
    <fieldset>
      <legend>C/C++ language server (clangd)</legend>
      <p className="muted">
        {clangd === undefined
          ? "Looking for clangd…"
          : clangd?.path
            ? `${clangd.configured ? "Chosen" : "Found"}: ${clangd.path}`
            : clangd?.configured
              ? "The chosen program is missing."
              : "Not found. Install clangd (LLVM) or choose the program."}
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={() => void choose(false).catch(onError)}>
          Choose program…
        </button>
        {clangd?.configured && (
          <button
            type="button"
            onClick={() => void choose(true).catch(onError)}
          >
            Use detected
          </button>
        )}
      </div>
    </fieldset>
  );
}

function CMake({ onError }: { onError: (e: unknown) => void }) {
  const { settings: info, kits } = useCMakeStore();
  const [folder, setFolder] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    loadSettings(true).catch(onError);
    loadKits().catch(onError);
  }, []);
  if (!info) return <p className="muted">Reading CMake settings…</p>;
  const settings = info.settings;
  const save = (change: Partial<CMakeSettings>) =>
    void saveCMakeSettings({ ...settings, ...change }).catch(onError);
  return (
    <fieldset>
      <legend>CMake</legend>
      <p className="muted">
        {info.program
          ? `${info.configured ? "Chosen" : "Found"}: ${info.program}`
          : info.configured
            ? "The chosen program is missing."
            : "Not found. Install CMake or choose the program."}
      </p>
      <div className="dialog-actions">
        <button
          type="button"
          onClick={() => void chooseProgram(false).catch(onError)}
        >
          Choose program…
        </button>
        {info.configured && (
          <button
            type="button"
            onClick={() => void chooseProgram(true).catch(onError)}
          >
            Use detected
          </button>
        )}
      </div>
      <label>
        Generator{" "}
        <select
          value={settings.generator}
          onChange={(e) => save({ generator: e.target.value })}
        >
          <option value="">Automatic (Ninja when found)</option>
          {info.generators.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label>
        Build folder{" "}
        <input
          aria-label="Build folder"
          value={folder ?? settings.buildDirectory}
          onChange={(e) => setFolder(e.target.value)}
          onBlur={() => {
            if (folder !== null && folder !== settings.buildDirectory)
              save({ buildDirectory: folder });
            setFolder(null);
          }}
        />
      </label>
      <p className="muted">
        {"${sourceDir}, ${kit}, ${variant}. Presets use their own binaryDir."}
      </p>
      <label>
        Parallel jobs{" "}
        <input
          type="number"
          min={0}
          max={512}
          aria-label="Parallel jobs"
          value={settings.parallelJobs}
          onChange={(e) =>
            save({
              parallelJobs: Math.max(
                0,
                Math.min(512, Number(e.target.value) || 0),
              ),
            })
          }
        />{" "}
        <span className="muted">0: the generator's default</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.buildBeforeRun}
          onChange={(e) => save({ buildBeforeRun: e.target.checked })}
        />{" "}
        Build the target before Run
      </label>
      <div className="settings-kits">
        <span>Kits</span>
        <button
          type="button"
          disabled={scanning}
          onClick={() => {
            setScanning(true);
            void loadKits(true)
              .catch(onError)
              .finally(() => setScanning(false));
          }}
        >
          {scanning ? "Scanning…" : "Scan for kits"}
        </button>
      </div>
      <ul className="settings-kit-list" aria-label="Kits">
        {kits?.map((kit) => (
          <li key={kit.id} title={kit.cxx}>
            {kit.name}
          </li>
        ))}
        {kits && !kits.length && (
          <li className="muted">No compilers were found.</li>
        )}
      </ul>
    </fieldset>
  );
}
