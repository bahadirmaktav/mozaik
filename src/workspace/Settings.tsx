import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Dialog } from "../components/Dialog";
import { native } from "../services/native";
import {
  DEFAULT_TODO_TAGS,
  preferencesBackend,
  type Preferences,
} from "../services/preferences";
import { defaultCMakeSettings, type CMakeSettings } from "../services/cmake";
import {
  loadShells,
  ShellSetting,
  type ShellChoices,
} from "../plugins/terminal/ShellSetting";
import {
  ClangTidyProgram,
  ClangdProgram,
  CMakeField,
  CMakeProgram,
  Kits,
  TodoTags,
} from "../plugins/ide/IdeSettings";
import {
  loadSettings,
  saveCMakeSettings,
  useCMakeStore,
} from "../plugins/ide/cmake";
import { message } from "../plugins/ide/editors";
import {
  analysisBackend,
  defaultAnalysisSettings,
  type AnalysisSettings,
} from "../services/analysis";
import {
  loadInfo as loadAnalysis,
  setInfo as setAnalysisInfo,
  useAnalysisInfo,
} from "../plugins/ide/analysis";
import { restart as restartClangd } from "../plugins/ide/lsp";
import { allProjects } from "../plugins/ide/projects";
import { shortcuts, type Scope } from "./keybindings";
import { ShortcutRow } from "./ShortcutSettings";
import {
  DEFAULT_MODIFIER,
  modifierLabel,
  modifiers,
  type Modifier,
} from "./shortcuts";

type Tab = "general" | "text" | "ide" | "terminal" | "files" | "tasks";
/** General first, then one tab per module, as in VS Code's settings. */
const TABS: [Tab, string][] = [
  ["general", "General"],
  ["text", "Text Editor"],
  ["ide", "IDE"],
  ["terminal", "Terminal"],
  ["files", "File Manager"],
  ["tasks", "Tasks and Notes"],
];
const SCOPE_TAB: Record<Scope, Tab> = {
  Workspace: "general",
  Editors: "text",
  "Code Editor": "ide",
  Terminal: "terminal",
  "File Manager": "files",
  "Tasks and Notes": "tasks",
};
/** Everything Save writes; nothing applies before (window opacity is previewed). */
export interface Draft {
  modifier: Modifier;
  preferences: Preferences;
  /** null: the system's shell. */
  shell: string | null;
  /** null until read. */
  cmake: CMakeSettings | null;
  /** null until read. */
  analysis: AnalysisSettings | null;
}
interface Item {
  tab: Tab;
  section: string;
  label: string;
  description?: string;
  /** More words the search finds it by. */
  keywords?: string;
  control: ReactNode;
  /** The control goes under the text (long values, lists). */
  wide?: boolean;
  reset?: (draft: Draft) => Draft;
}

/** A start folder: typed or chosen in the native dialog; empty is the home folder. */
function FolderSetting({
  name,
  value,
  onChange,
  onError,
}: {
  name: string;
  value: string | null;
  onChange: (folder: string | null) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <div className="settings-folder">
      <input
        type="text"
        aria-label={name}
        placeholder="Home folder"
        spellCheck={false}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value.trim() ? e.target.value : null)
        }
      />
      {isTauri() && (
        <button
          type="button"
          onClick={() =>
            void preferencesBackend
              .chooseFolder()
              .then((folder) => folder && onChange(folder))
              .catch(onError)
          }
        >
          Choose…
        </button>
      )}
    </div>
  );
}

export function Settings({
  modifier,
  preferences,
  onSave,
  onClose,
  ask,
}: {
  modifier: Modifier;
  preferences: Preferences;
  onSave: (draft: Draft) => void;
  onClose: () => void;
  ask: (title: string, message: string, choices: string[]) => Promise<string>;
}) {
  const initial: Draft = {
    modifier,
    preferences,
    shell: null,
    cmake: null,
    analysis: null,
  };
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<Tab>("general");
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [shells, setShells] = useState<ShellChoices | null>(null);
  const [error, setError] = useState("");
  // Shown at the CMake values; the rest of the settings work without them.
  const [cmakeError, setCMakeError] = useState("");
  const { settings: cmakeInfo } = useCMakeStore();
  const analysisInfo = useAnalysisInfo();
  const [analysisError, setAnalysisError] = useState("");
  const fail = (e: unknown) => setError(message(e));
  useEffect(() => {
    if (isTauri())
      void loadShells()
        .then((choices) => {
          setShells(choices);
          const known = (d: Draft) => ({ ...d, shell: choices.selected });
          setBase(known);
          setDraft(known);
        })
        .catch(fail);
    void loadAnalysis(true)
      .then((info) => {
        const known = (d: Draft) => ({ ...d, analysis: info.settings });
        setBase(known);
        setDraft(known);
      })
      .catch((e) => setAnalysisError(message(e)));
    void loadSettings(true)
      .then((info) => {
        const known = (d: Draft) => ({ ...d, cmake: info.settings });
        setBase(known);
        setDraft(known);
      })
      .catch((e) => setCMakeError(message(e)));
  }, []);
  // The window's opacity shows while it is chosen; leaving unsaved puts it back.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--window-opacity",
      String(draft.preferences.opacity),
    );
  }, [draft.preferences.opacity]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  function leave() {
    document.documentElement.style.setProperty(
      "--window-opacity",
      String(base.preferences.opacity),
    );
    onClose();
  }
  async function save() {
    const folder = (value: string | null) => value?.trim() || null;
    const saved: Draft = {
      ...draft,
      preferences: {
        ...draft.preferences,
        terminalFolder: folder(draft.preferences.terminalFolder),
        fileManagerFolder: folder(draft.preferences.fileManagerFolder),
      },
    };
    const { terminalFolder, fileManagerFolder } = saved.preferences;
    const relative = [terminalFolder, fileManagerFolder].find(
      (value) => value && !/^([a-z]:[\\/]|[\\/])/i.test(value),
    );
    if (relative)
      return setError(
        `The start folder ${relative} must be a full path, like C:\\Projects or /home/me.`,
      );
    try {
      if (draft.shell && draft.shell !== base.shell)
        await native("set_default_shell", { shell: draft.shell });
      if (
        draft.cmake &&
        JSON.stringify(draft.cmake) !== JSON.stringify(base.cmake)
      )
        await saveCMakeSettings(draft.cmake);
      if (
        draft.analysis &&
        JSON.stringify(draft.analysis) !== JSON.stringify(base.analysis)
      ) {
        setAnalysisInfo(await analysisBackend.setSettings(draft.analysis));
        // clangd starts with or without the live clang-tidy checks.
        if (draft.analysis.clangTidyEnabled !== base.analysis?.clangTidyEnabled)
          for (const project of allProjects())
            if (project.root) restartClangd(project.root);
      }
      onSave(saved);
      setBase(saved);
      onClose();
    } catch (e) {
      fail(e);
    }
  }
  async function cancel() {
    if (!dirty) return leave();
    const choice = await ask("Unsaved settings", "Save the changed settings?", [
      "Save",
      "Discard",
      "Cancel",
    ]);
    if (choice === "Save") await save();
    else if (choice === "Discard") leave();
  }

  const key = modifierLabel(draft.modifier);
  const cmake = draft.cmake;
  const cmakeItem = (
    field: keyof CMakeSettings,
    label: string,
    description: string,
  ): Item => ({
    tab: "ide",
    section: "CMake",
    label,
    description,
    keywords: "cmake build",
    control: cmake ? (
      <CMakeField
        field={field}
        value={cmake}
        generators={cmakeInfo?.generators ?? []}
        onChange={(value) => setDraft({ ...draft, cmake: value })}
      />
    ) : (
      <span className="muted">{cmakeError || "Reading…"}</span>
    ),
    wide: field === "buildDirectory",
    reset: (d) =>
      d.cmake
        ? { ...d, cmake: { ...d.cmake, [field]: defaultCMakeSettings[field] } }
        : d,
  });
  const analysis = draft.analysis;
  const analysisItem = (
    field: keyof AnalysisSettings,
    label: string,
    description: string,
  ): Item => {
    const set = (change: Partial<AnalysisSettings>) =>
      analysis && setDraft({ ...draft, analysis: { ...analysis, ...change } });
    return {
      tab: "ide",
      section: "Code Analysis",
      label,
      description,
      keywords: "analysis lint static clang-tidy",
      control: !analysis ? (
        <span className="muted">{analysisError || "Reading…"}</span>
      ) : field === "clangTidyEnabled" ? (
        <input
          type="checkbox"
          aria-label={label}
          checked={analysis.clangTidyEnabled}
          onChange={(e) => set({ clangTidyEnabled: e.target.checked })}
        />
      ) : field === "maxParallelJobs" ? (
        <input
          type="number"
          aria-label={label}
          min={1}
          max={16}
          value={analysis.maxParallelJobs}
          onChange={(e) =>
            set({
              maxParallelJobs: Math.min(
                16,
                Math.max(1, Math.round(Number(e.target.value) || 1)),
              ),
            })
          }
        />
      ) : (
        <select
          aria-label={label}
          value={analysis.autoAnalysis}
          onChange={(e) =>
            set({
              autoAnalysis: e.target.value as AnalysisSettings["autoAnalysis"],
            })
          }
        >
          <option value="off">Off</option>
          <option value="onSave">The saved file</option>
        </select>
      ),
      reset: (d) =>
        d.analysis
          ? {
              ...d,
              analysis: {
                ...d.analysis,
                [field]: defaultAnalysisSettings[field],
              },
            }
          : d,
    };
  };
  const warning = modifiers.find((m) => m.value === draft.modifier)?.warning;
  const items: Item[] = [
    {
      tab: "general",
      section: "Workspace",
      label: "Workspace key",
      description: "Held for the launcher, focus and panel drags.",
      keywords: "modifier ctrl alt",
      control: (
        <>
          <select
            aria-label="Workspace key"
            value={draft.modifier}
            onChange={(e) =>
              setDraft({ ...draft, modifier: e.target.value as Modifier })
            }
          >
            {modifiers.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
            <option disabled>Right Alt (AltGr) — not available</option>
          </select>
          {warning && (
            <p className="settings-warning" role="note">
              {warning}
            </p>
          )}
        </>
      ),
      reset: (d) => ({ ...d, modifier: DEFAULT_MODIFIER }),
    },
    {
      tab: "general",
      section: "Window",
      label: "Window opacity",
      description: "The whole window; dialogs stay opaque.",
      keywords: "transparency",
      control: (
        <span className="settings-range">
          <input
            type="range"
            aria-label="Window opacity"
            min={30}
            max={100}
            step={1}
            value={Math.round(draft.preferences.opacity * 100)}
            onChange={(e) =>
              setDraft({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  opacity: Number(e.target.value) / 100,
                },
              })
            }
          />
          <output>{Math.round(draft.preferences.opacity * 100)}%</output>
        </span>
      ),
      reset: (d) => ({ ...d, preferences: { ...d.preferences, opacity: 1 } }),
    },
    {
      tab: "text",
      section: "Display",
      label: "Word wrap",
      description:
        "Long lines wrap at the panel's width; the wrapped part keeps the line's number and indentation.",
      keywords: "wrap soft lines",
      control: (
        <input
          type="checkbox"
          aria-label="Word wrap"
          checked={draft.preferences.wordWrap}
          onChange={(e) =>
            setDraft({
              ...draft,
              preferences: {
                ...draft.preferences,
                wordWrap: e.target.checked,
              },
            })
          }
        />
      ),
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, wordWrap: true },
      }),
    },
    {
      tab: "ide",
      section: "Language server",
      label: "clangd",
      description:
        "The C/C++ language server. A chosen program applies at once.",
      keywords: "lsp program",
      control: <ClangdProgram onError={fail} />,
      wide: true,
    },
    {
      tab: "ide",
      section: "CMake",
      label: "CMake program",
      description: "A chosen program applies at once.",
      keywords: "cmake",
      control: <CMakeProgram info={cmakeInfo} onError={fail} />,
      wide: true,
    },
    cmakeItem(
      "generator",
      "Generator",
      "Ninja when found, unless one is chosen.",
    ),
    cmakeItem(
      "buildDirectory",
      "Build folder",
      "${sourceDir}, ${kit} and ${variant} are replaced. Presets use their own binaryDir.",
    ),
    cmakeItem("parallelJobs", "Parallel jobs", "0 leaves it to the generator."),
    cmakeItem(
      "buildBeforeRun",
      "Build the target before Run",
      "Run builds its target first.",
    ),
    {
      tab: "ide",
      section: "Kits",
      label: "Compilers",
      description: "Visual Studio, MinGW, Clang and GCC found on this system.",
      keywords: "kits msvc gcc clang compiler scan",
      control: <Kits onError={fail} />,
      wide: true,
    },
    {
      tab: "ide",
      section: "Code Analysis",
      label: "clang-tidy program",
      description:
        "Runs the checks of the project's .clang-tidy on one file or the whole project. A chosen program applies at once.",
      keywords: "analysis lint static clang-tidy program",
      control: <ClangTidyProgram info={analysisInfo} onError={fail} />,
      wide: true,
    },
    analysisItem(
      "clangTidyEnabled",
      "clang-tidy checks",
      "clangd shows the project's clang-tidy checks while editing; the Analysis commands run clang-tidy itself.",
    ),
    analysisItem(
      "maxParallelJobs",
      "Parallel analyses",
      "How many files a project analysis checks at once.",
    ),
    analysisItem(
      "autoAnalysis",
      "Analyze on save",
      "Runs clang-tidy on a saved C/C++ file of an IDE project. Projects are only analyzed on request.",
    ),
    {
      tab: "ide",
      section: "TODO Tree",
      label: "Tags",
      description:
        "Comment tags the TODOs view lists and the code editor highlights, one per line (e.g. TODO, FIXME, INFO).",
      keywords: "todo fixme note info tags comments todo tree",
      control: (
        <TodoTags
          tags={draft.preferences.todoTags}
          onChange={(todoTags) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, todoTags },
            })
          }
        />
      ),
      wide: true,
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, todoTags: DEFAULT_TODO_TAGS },
      }),
    },
    {
      tab: "terminal",
      section: "Shell",
      label: "Default shell",
      description: "For new terminals.",
      keywords: "powershell bash cmd",
      control: isTauri() ? (
        <ShellSetting
          choices={shells}
          value={draft.shell}
          onChange={(shell) => setDraft({ ...draft, shell })}
        />
      ) : (
        <span className="muted">Shell selection requires the desktop app.</span>
      ),
      reset: (d) => (shells?.system ? { ...d, shell: shells.system } : d),
    },
    {
      tab: "terminal",
      section: "Shell",
      label: "Start folder",
      description:
        "Where new terminals start; empty is the home folder. IDE terminals start in the project folder.",
      keywords: "directory cwd working folder home",
      control: (
        <FolderSetting
          name="Terminal start folder"
          value={draft.preferences.terminalFolder}
          onChange={(terminalFolder) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, terminalFolder },
            })
          }
          onError={fail}
        />
      ),
      wide: true,
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, terminalFolder: null },
      }),
    },
    {
      tab: "files",
      section: "Folders",
      label: "Start folder",
      description:
        "The folder a new File Manager panel shows; empty is the home folder.",
      keywords: "directory home location",
      control: (
        <FolderSetting
          name="File Manager start folder"
          value={draft.preferences.fileManagerFolder}
          onChange={(fileManagerFolder) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, fileManagerFolder },
            })
          }
          onError={fail}
        />
      ),
      wide: true,
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, fileManagerFolder: null },
      }),
    },
    ...shortcuts.map((shortcut): Item => ({
      tab: SCOPE_TAB[shortcut.scope],
      section:
        shortcut.scope === "Editors"
          ? "Shortcuts (text and code editors)"
          : "Shortcuts",
      label: shortcut.label,
      keywords: `shortcut key ${shortcut.keys} ${shortcut.scope}`,
      control: (
        <ShortcutRow
          shortcut={shortcut}
          custom={draft.preferences.keybindings}
          workspaceKey={key}
          onChange={(keybindings) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, keybindings },
            })
          }
        />
      ),
      reset: (d) => {
        const keybindings = { ...d.preferences.keybindings };
        delete keybindings[shortcut.id];
        return { ...d, preferences: { ...d.preferences, keybindings } };
      },
    })),
  ];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tabName = (t: Tab) => TABS.find(([id]) => id === t)![1];
  const shown = words.length
    ? items.filter((item) => {
        const text =
          `${tabName(item.tab)} ${item.section} ${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
    : items.filter((item) => item.tab === tab);
  const sections = new Map<string, Item[]>();
  for (const item of shown) {
    const name = words.length
      ? `${tabName(item.tab)} › ${item.section}`
      : item.section;
    sections.set(name, [...(sections.get(name) ?? []), item]);
  }
  return (
    <Dialog title="Workspace settings" onCancel={() => void cancel()}>
      <div className="settings-layout">
        <input
          className="settings-search"
          type="search"
          autoFocus
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
        >
          {TABS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={!words.length && tab === id}
              aria-controls="settings-page"
              onClick={() => {
                setQuery("");
                setTab(id);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div
          className="settings"
          id="settings-page"
          role="tabpanel"
          aria-labelledby={words.length ? undefined : `settings-tab-${tab}`}
          aria-label={words.length ? "Search results" : undefined}
        >
          {!shown.length && (
            <p className="muted">No settings match “{query}”.</p>
          )}
          {[...sections].map(([name, list]) => {
            const id = words.length ? name : `${tab}:${name}`;
            // A search shows every match.
            const open = words.length > 0 || !closed.has(id);
            return (
              <section
                key={name}
                className="settings-section"
                aria-label={name}
              >
                <button
                  type="button"
                  className="settings-section-title"
                  aria-expanded={open}
                  onClick={() => {
                    const next = new Set(closed);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    setClosed(next);
                  }}
                >
                  <span aria-hidden>{open ? "▾" : "▸"}</span> {name}
                </button>
                {open &&
                  list.map((item) =>
                    item.section.startsWith("Shortcuts") ? (
                      <div key={item.label + item.keywords}>{item.control}</div>
                    ) : (
                      <div
                        key={item.label}
                        className={`settings-item${item.wide ? " wide" : ""}`}
                      >
                        <div className="settings-text">
                          <span className="settings-label">{item.label}</span>
                          {item.description && (
                            <span className="muted">{item.description}</span>
                          )}
                        </div>
                        <div className="settings-control">{item.control}</div>
                      </div>
                    ),
                  )}
              </section>
            );
          })}
        </div>
      </div>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions settings-actions">
        <button
          type="button"
          title={
            words.length
              ? "Reset the settings found to their defaults"
              : `Reset ${tabName(tab)} to its defaults`
          }
          onClick={() =>
            setDraft(shown.reduce((d, item) => item.reset?.(d) ?? d, draft))
          }
        >
          Reset to Default
        </button>
        <span className="settings-state muted">
          {dirty ? "Unsaved changes" : ""}
        </span>
        <button type="button" onClick={() => void cancel()}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!dirty}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
