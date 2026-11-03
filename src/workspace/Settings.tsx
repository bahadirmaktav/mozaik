import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Dialog } from "../components/Dialog";
import { native } from "../services/native";
import {
  DEFAULT_TODO_TAGS,
  defaultFonts,
  IDE_FONT_SIZE,
  preferencesBackend,
  type FontPreferences,
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
import { FEATURES } from "../plugins/ide/features";
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
import {
  CODE_FONT,
  installed,
  installedFonts,
  shownFamily,
  systemFont,
  TERMINAL_FONT,
  validFont,
  type FontModule,
} from "./fonts";
import { shortcuts, type Scope } from "./keybindings";
import { applyTheme, DEFAULT_THEME, THEMES } from "./themes";
import {
  DEFAULT_ICON_THEME,
  ICON_THEMES,
  setIconTheme,
} from "../plugins/ide/fileIcons";
import { ShortcutRow } from "./ShortcutSettings";
import {
  DEFAULT_MODIFIER,
  modifierLabel,
  modifiers,
  type Modifier,
} from "./shortcuts";

type Tab = "general" | "text" | "ide" | "terminal" | "files" | "tasks";
export type SettingsTab = Tab;
/** General first, then one tab per module, as in VS Code's settings. */
const TABS: [Tab, string][] = [
  ["general", "General"],
  ["text", "Text Editor"],
  ["ide", "IDE"],
  ["terminal", "Terminal"],
  ["files", "File Manager"],
  ["tasks", "Tasks and Notes"],
];
const tabName = (t: Tab) => TABS.find(([id]) => id === t)![1];
const SCOPE_TAB: Record<Scope, Tab> = {
  Workspace: "general",
  Editors: "text",
  "Code Editor": "ide",
  Terminal: "terminal",
  "File Manager": "files",
  "Tasks and Notes": "tasks",
};
/** Everything Save writes; nothing applies before (window opacity and the theme are
 * previewed). */
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

/** A folder (or file): typed or chosen in the native dialog; empty is the default. */
function FolderSetting({
  name,
  value,
  placeholder = "Home folder",
  choose = preferencesBackend.chooseFolder,
  onChange,
  onError,
}: {
  name: string;
  value: string | null;
  placeholder?: string;
  choose?: () => Promise<string | null>;
  onChange: (folder: string | null) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <div className="settings-folder">
      <input
        type="text"
        aria-label={name}
        placeholder={placeholder}
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
            void choose()
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

/**
 * A font family: typed, or picked from the installed common ones; empty is the default,
 * which the list offers first under `defaultLabel` (e.g. "System font (Segoe UI)"). The
 * list shows every font when it opens and filters only once the user types (a datalist
 * would show just the fonts matching the chosen one).
 */
function FontSetting({
  name,
  value,
  defaultLabel,
  disabled,
  disabledReason,
  onChange,
}: {
  name: string;
  value: string | null;
  defaultLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (font: string | null) => void;
}) {
  const list = `fonts-${name.replace(/\W/g, "-")}`;
  const font = value?.trim();
  // null: closed; "": every font; otherwise the typed filter.
  const [filter, setFilter] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const typed = (filter ?? "").trim().toLowerCase();
  // null is the default font.
  const fonts = [null, ...installedFonts()].filter((f) =>
    (f ?? defaultLabel).toLowerCase().includes(typed),
  );
  const open = filter !== null && !disabled && fonts.length > 0;
  const show = () => {
    setFilter("");
    setActive(Math.max(0, [null, ...installedFonts()].indexOf(font || null)));
  };
  const pick = (f: string | null) => {
    onChange(f);
    setFilter(null);
  };
  const reason = disabled ? disabledReason : undefined;
  return (
    <div className="settings-font" title={reason}>
      <div className="settings-font-field">
        <input
          type="text"
          role="combobox"
          aria-label={name}
          aria-expanded={open}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${list}-${active}` : undefined}
          title={reason}
          placeholder={defaultLabel}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          value={value ?? ""}
          style={
            font && validFont(font) ? { fontFamily: `"${font}"` } : undefined
          }
          onClick={() => filter === null && show()}
          onBlur={() => setFilter(null)}
          onChange={(e) => {
            onChange(e.target.value.trim() ? e.target.value : null);
            setFilter(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return show();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((active + step + fonts.length) % fonts.length);
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              pick(fonts[Math.min(active, fonts.length - 1)]);
            } else if (e.key === "Escape" && open) {
              // Closes the list, not the settings.
              e.preventDefault();
              e.stopPropagation();
              setFilter(null);
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show fonts for ${name}`}
          title={reason}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            (e.currentTarget.previousSibling as HTMLInputElement).focus();
            if (open) setFilter(null);
            else show();
          }}
        >
          ▾
        </button>
        {open && (
          <div className="settings-font-list" role="listbox" id={list}>
            {fonts.map((f, i) => (
              <div
                key={f ?? ""}
                id={`${list}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                style={f ? { fontFamily: `"${f}"` } : undefined}
                ref={(el) => {
                  if (i === active) el?.scrollIntoView({ block: "nearest" });
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(f);
                }}
                onMouseMove={() => i !== active && setActive(i)}
              >
                {f ?? defaultLabel}
              </div>
            ))}
          </div>
        )}
      </div>
      {font && !disabled && (
        <span className="settings-warning" role="note">
          {!validFont(font)
            ? "One font name, without quotes, commas or brackets."
            : !installed(font)
              ? "Not found on this system; the default font is used."
              : ""}
        </span>
      )}
    </div>
  );
}

export function Settings({
  tab: initialTab = "general",
  modifier,
  preferences,
  onSave,
  onClose,
  ask,
}: {
  /** The tab shown first. */
  tab?: Tab;
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
  const [tab, setTab] = useState<Tab>(initialTab);
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
  useEffect(
    () => applyTheme(draft.preferences.theme),
    [draft.preferences.theme],
  );
  useEffect(
    () => setIconTheme(draft.preferences.ideIconTheme),
    [draft.preferences.ideIconTheme],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  function leave() {
    document.documentElement.style.setProperty(
      "--window-opacity",
      String(base.preferences.opacity),
    );
    applyTheme(base.preferences.theme);
    setIconTheme(base.preferences.ideIconTheme);
    onClose();
  }
  async function save() {
    const folder = (value: string | null) => value?.trim() || null;
    const fonts = Object.fromEntries(
      Object.entries(draft.preferences.fonts).map(([k, v]) => [
        k,
        typeof v === "string" ? folder(v) : v,
      ]),
    ) as unknown as FontPreferences;
    const badFont = Object.values(fonts).find(
      (v) => typeof v === "string" && !validFont(v),
    );
    if (badFont)
      return setError(
        `The font ${badFont} must be one font name, without quotes, commas or brackets.`,
      );
    const saved: Draft = {
      ...draft,
      preferences: {
        ...draft.preferences,
        fonts,
        terminalFolder: folder(draft.preferences.terminalFolder),
        fileManagerFolder: folder(draft.preferences.fileManagerFolder),
        notesFolder: folder(draft.preferences.notesFolder),
        powershellPrompt: folder(draft.preferences.powershellPrompt),
      },
    };
    const { terminalFolder, fileManagerFolder, notesFolder } =
      saved.preferences;
    const relative = [terminalFolder, fileManagerFolder, notesFolder].find(
      (value) => value && !/^([a-z]:[\\/]|[\\/])/i.test(value),
    );
    if (relative)
      return setError(
        `The folder ${relative} must be a full path, like C:\\Projects or /home/me.`,
      );
    const prompt = saved.preferences.powershellPrompt;
    if (prompt && !/^([a-z]:[\\/]|[\\/]).*\.ps1$/i.test(prompt))
      return setError(
        `The PowerShell prompt ${prompt} must be the full path of a .ps1 file.`,
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
  const fonts = draft.preferences.fonts;
  const setFonts = (change: Partial<FontPreferences>) =>
    setDraft({
      ...draft,
      preferences: { ...draft.preferences, fonts: { ...fonts, ...change } },
    });
  const everywhere = fonts.all && !!fonts.ui?.trim();
  // Each field's empty value, named after the font it shows where it is known.
  const named = (label: string, font: string | null) =>
    font ? `${label} (${font})` : label;
  const general = fonts.ui?.trim();
  const generalFont = general && validFont(general) ? general : systemFont();
  const codeDefault = named("Default", shownFamily(CODE_FONT));
  const fontDefaults: Record<FontModule, string> = {
    textEditor: codeDefault,
    ide: codeDefault,
    terminal: named("Default", shownFamily(TERMINAL_FONT)),
    fileManager: named("General font", generalFont),
    tasks: named("General font", generalFont),
    notes: named("General font", generalFont),
  };
  const fontItem = (
    tab: Tab,
    module: FontModule,
    label: string,
    description: string,
  ): Item => ({
    tab,
    section: "Font",
    label,
    description: everywhere
      ? `${description} General → Use for all modules is on.`
      : description,
    keywords: "font family typeface",
    control: (
      <FontSetting
        name={label === "Font" ? `${tabName(tab)} font` : label}
        value={fonts[module]}
        defaultLabel={fontDefaults[module]}
        disabled={everywhere}
        disabledReason="General → Use for all modules is on, so this module uses the General font."
        onChange={(font) => setFonts({ [module]: font })}
      />
    ),
    wide: true,
    reset: (d) => ({
      ...d,
      preferences: {
        ...d.preferences,
        fonts: { ...d.preferences.fonts, [module]: null },
      },
    }),
  });
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
      label: "Theme",
      description:
        "The colors of the whole window. Preferences: Color Theme in the command palette previews them too.",
      keywords: "color colour theme dark light appearance",
      control: (
        <select
          aria-label="Theme"
          value={draft.preferences.theme}
          onChange={(e) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, theme: e.target.value },
            })
          }
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ),
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, theme: DEFAULT_THEME },
      }),
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
      tab: "general",
      section: "Font",
      label: "Font",
      description:
        "The interface font. Modules without their own font follow it; editors and terminals keep their monospace font.",
      keywords: "font family typeface interface ui",
      control: (
        <FontSetting
          name="General font"
          defaultLabel={named("System font", systemFont())}
          value={fonts.ui}
          onChange={(ui) => setFonts({ ui })}
        />
      ),
      wide: true,
      reset: (d) => ({
        ...d,
        preferences: {
          ...d.preferences,
          fonts: { ...d.preferences.fonts, ui: null },
        },
      }),
    },
    {
      tab: "general",
      section: "Font",
      label: "Use for all modules",
      description:
        "Every module (Text Editor, IDE, Terminal, File Manager, Tasks and Notes) uses the font above instead of its own.",
      keywords: "font family typeface all modules everywhere",
      control: (
        <input
          type="checkbox"
          aria-label="Use the General font for all modules"
          checked={fonts.all}
          disabled={!fonts.ui?.trim()}
          onChange={(e) => setFonts({ all: e.target.checked })}
        />
      ),
      reset: (d) => ({
        ...d,
        preferences: {
          ...d.preferences,
          fonts: { ...d.preferences.fonts, all: defaultFonts.all },
        },
      }),
    },
    fontItem(
      "text",
      "textEditor",
      "Font",
      "Text Editor tabs and the Mermaid source.",
    ),
    // As extensions in VS Code: each built-in IDE feature can be turned off.
    ...FEATURES.map((feature): Item => {
      const off = draft.preferences.ideDisabledFeatures;
      const needs = FEATURES.find((f) => f.id === feature.needs);
      const set = (on: boolean) =>
        setDraft({
          ...draft,
          preferences: {
            ...draft.preferences,
            ideDisabledFeatures: on
              ? off.filter((id) => id !== feature.id)
              : [...off, feature.id],
          },
        });
      return {
        tab: "ide",
        section: "Features",
        label: feature.name,
        description: needs
          ? `${feature.description} Needs ${needs.name}.`
          : feature.description,
        keywords: "feature extension plugin enable disable turn off",
        control: (
          <input
            type="checkbox"
            aria-label={feature.name}
            checked={!off.includes(feature.id)}
            disabled={!!needs && off.includes(needs.id)}
            onChange={(e) => set(e.target.checked)}
          />
        ),
        reset: (d) => ({
          ...d,
          preferences: {
            ...d.preferences,
            ideDisabledFeatures: d.preferences.ideDisabledFeatures.filter(
              (id) => id !== feature.id,
            ),
          },
        }),
      };
    }),
    fontItem(
      "ide",
      "ide",
      "Font",
      "Code editors, comparisons, Output, Debug Console and search results.",
    ),
    {
      tab: "ide",
      section: "Explorer",
      label: "File icon theme",
      description:
        "The icons before the Explorer's files and folders. Preferences: File Icon Theme in the command palette previews them.",
      keywords: "icons seti minimal folders explorer",
      control: (
        <select
          aria-label="File icon theme"
          value={draft.preferences.ideIconTheme}
          onChange={(e) =>
            setDraft({
              ...draft,
              preferences: {
                ...draft.preferences,
                ideIconTheme: e.target.value,
              },
            })
          }
        >
          {ICON_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ),
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, ideIconTheme: DEFAULT_ICON_THEME },
      }),
    },
    {
      tab: "ide",
      section: "Font",
      label: "Font size",
      description:
        "Text of the code editors and comparisons, in pixels. IDE: Zoom In and Zoom Out change it too.",
      keywords: "font size zoom text scale",
      control: (
        <select
          aria-label="IDE font size"
          value={draft.preferences.ideFontSize}
          onChange={(e) =>
            setDraft({
              ...draft,
              preferences: {
                ...draft.preferences,
                ideFontSize: Number(e.target.value),
              },
            })
          }
        >
          {Array.from(
            { length: IDE_FONT_SIZE.max - IDE_FONT_SIZE.min + 1 },
            (_, i) => IDE_FONT_SIZE.min + i,
          ).map((size) => (
            <option key={size} value={size}>
              {size}px{size === IDE_FONT_SIZE.default ? " (default)" : ""}
            </option>
          ))}
        </select>
      ),
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, ideFontSize: IDE_FONT_SIZE.default },
      }),
    },
    fontItem(
      "terminal",
      "terminal",
      "Font",
      "Terminals, also in the IDE. A Nerd Font shows prompt icons.",
    ),
    fontItem("files", "fileManager", "Font", "The File Manager."),
    fontItem("tasks", "tasks", "Tasks font", "The Tasks panel."),
    fontItem("tasks", "notes", "Notes font", "The Notes panel and its editor."),
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
      tab: "terminal",
      section: "Shell",
      label: "PowerShell prompt",
      description:
        "A .ps1 file new PowerShell terminals run after your profile, usually to set the prompt; empty keeps the shell's own prompt. The repository has an example in examples/powershell.",
      keywords: "prompt profile style script ps1 pwsh git venv",
      control: (
        <FolderSetting
          name="PowerShell prompt file"
          placeholder="Shell's own prompt"
          value={draft.preferences.powershellPrompt}
          choose={preferencesBackend.choosePrompt}
          onChange={(powershellPrompt) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, powershellPrompt },
            })
          }
          onError={fail}
        />
      ),
      wide: true,
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, powershellPrompt: null },
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
    {
      tab: "tasks",
      section: "Notes",
      label: "Notes folder",
      description:
        "Each note is a Markdown file in this folder and each group a subfolder.",
      keywords: "directory markdown groups",
      control: (
        <FolderSetting
          name="Notes folder"
          placeholder="Not chosen"
          value={draft.preferences.notesFolder}
          onChange={(notesFolder) =>
            setDraft({
              ...draft,
              preferences: { ...draft.preferences, notesFolder },
            })
          }
          onError={fail}
        />
      ),
      wide: true,
      reset: (d) => ({
        ...d,
        preferences: { ...d.preferences, notesFolder: null },
      }),
    },
    ...shortcuts.map((shortcut): Item => ({
      tab: SCOPE_TAB[shortcut.scope],
      section:
        shortcut.scope === "Editors"
          ? "Shortcuts (text and code editors, notes)"
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
