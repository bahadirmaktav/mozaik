import { useEffect, useState } from "react";
import { ideBackend, type ServerInfo } from "../../services/ide";
import type { CMakeSettings, CMakeSettingsInfo } from "../../services/cmake";
import { chooseProgram, loadKits, useCMakeStore } from "./cmake";
import { restart, serverInfo } from "./lsp";
import { allProjects } from "./projects";

/*
 * Workspace Settings → IDE. Programs are chosen in a native dialog and apply at once (the
 * renderer never names a program); the CMake values are part of the settings draft.
 */

export function ClangdProgram({ onError }: { onError: (e: unknown) => void }) {
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
    <Program
      status={
        clangd === undefined
          ? "Looking for clangd…"
          : clangd?.path
            ? `${clangd.configured ? "Chosen" : "Found"}: ${clangd.path}`
            : clangd?.configured
              ? "The chosen program is missing."
              : "Not found. Install clangd (LLVM) or choose the program."
      }
      configured={!!clangd?.configured}
      onChoose={(reset) => void choose(reset).catch(onError)}
    />
  );
}

export function CMakeProgram({
  info,
  onError,
}: {
  info: CMakeSettingsInfo | null;
  onError: (e: unknown) => void;
}) {
  return (
    <Program
      status={
        !info
          ? "Looking for CMake…"
          : info.program
            ? `${info.configured ? "Chosen" : "Found"}: ${info.program}`
            : info.configured
              ? "The chosen program is missing."
              : "Not found. Install CMake or choose the program."
      }
      configured={!!info?.configured}
      onChoose={(reset) => void chooseProgram(reset).catch(onError)}
    />
  );
}

function Program({
  status,
  configured,
  onChoose,
}: {
  status: string;
  configured: boolean;
  onChoose: (reset: boolean) => void;
}) {
  return (
    <div className="settings-program">
      <p className="muted">{status}</p>
      <div className="dialog-actions">
        <button type="button" onClick={() => onChoose(false)}>
          Choose program…
        </button>
        {configured && (
          <button type="button" onClick={() => onChoose(true)}>
            Use detected
          </button>
        )}
      </div>
    </div>
  );
}

/** One CMake value of the settings draft. */
export function CMakeField({
  field,
  value,
  generators,
  onChange,
}: {
  field: keyof CMakeSettings;
  value: CMakeSettings;
  generators: string[];
  onChange: (value: CMakeSettings) => void;
}) {
  const set = (change: Partial<CMakeSettings>) =>
    onChange({ ...value, ...change });
  switch (field) {
    case "generator":
      return (
        <select
          aria-label="Generator"
          value={value.generator}
          onChange={(e) => set({ generator: e.target.value })}
        >
          <option value="">Automatic (Ninja when found)</option>
          {generators.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      );
    case "buildDirectory":
      return (
        <input
          aria-label="Build folder"
          value={value.buildDirectory}
          onChange={(e) => set({ buildDirectory: e.target.value })}
        />
      );
    case "parallelJobs":
      return (
        <input
          type="number"
          min={0}
          max={512}
          aria-label="Parallel jobs"
          value={value.parallelJobs}
          onChange={(e) =>
            set({
              parallelJobs: Math.max(
                0,
                Math.min(512, Number(e.target.value) || 0),
              ),
            })
          }
        />
      );
    case "buildBeforeRun":
      return (
        <input
          type="checkbox"
          aria-label="Build the target before Run"
          checked={value.buildBeforeRun}
          onChange={(e) => set({ buildBeforeRun: e.target.checked })}
        />
      );
  }
}

export function Kits({ onError }: { onError: (e: unknown) => void }) {
  const { kits } = useCMakeStore();
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    loadKits().catch(onError);
  }, []);
  return (
    <div className="settings-kits">
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
      <ul className="settings-kit-list" aria-label="Kits">
        {kits?.map((kit) => (
          <li key={kit.id} title={kit.cxx}>
            {kit.name}
          </li>
        ))}
        {kits && !kits.length && (
          <li className="muted">No compilers were found.</li>
        )}
        {!kits && <li className="muted">Looking for compilers…</li>}
      </ul>
    </div>
  );
}

/** The TODO tags, one per line; spaces or commas also separate them. */
export function TodoTags({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const parse = (text: string) => [
    ...new Set(text.split(/[\s,]+/).filter(Boolean)),
  ];
  const [text, setText] = useState(tags.join("\n"));
  // Reset to Default replaces the tags from outside.
  useEffect(() => {
    if (parse(text).join("\n") !== tags.join("\n")) setText(tags.join("\n"));
  }, [tags]);
  const long = parse(text).find((tag) => tag.length > 30);
  return (
    <>
      <textarea
        aria-label="TODO tags"
        rows={5}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value).slice(0, 50));
        }}
      />
      {long && (
        <p className="settings-warning" role="note">
          {long} is longer than 30 characters and cannot be saved.
        </p>
      )}
    </>
  );
}
