import { useEffect } from "react";
import type { ViewProps } from "../contract";
import {
  build,
  cancel,
  choices,
  configure,
  loadKits,
  refresh,
  run,
  selectBuildPreset,
  selectBuildTarget,
  selectConfigurePreset,
  selectKit,
  selectRunTarget,
  selectVariant,
  useCMake,
  useCMakeStore,
  variantOf,
} from "./cmake";
import { allProblems, current, host, useEditors } from "./editors";
import {
  BranchIcon,
  BuildIcon,
  GearIcon,
  KitIcon,
  PackageIcon,
  PresetIcon,
} from "../../components/Icons";
import { getDocument, useDocuments } from "../text-editor/documents";
import { startDebugging, stopDebugging, useDebug } from "./debug";
import { useStatus } from "./panels";
import { dismissMessage, useLatestMessage } from "./channels";
import { within } from "./paths";
import { useProject } from "./projects";
import { cancelAnalysis, useAnalysis } from "./analysis";
import { useFeatures } from "./features";

const STEPS = {
  configure: "Configuring",
  reconfigure: "Configuring",
  build: "Building",
  clean: "Cleaning",
  cleanRebuild: "Building",
};

/**
 * The IDE's status bar: Git branch, CMake choices and actions, messages, the code file's
 * line ending and encoding, problem counts.
 */
export default function Status({ instanceId }: ViewProps) {
  const project = useProject(useStatus(instanceId) ?? "");
  useEditors();
  useDocuments();
  const root = project?.root ?? null;
  const code = current();
  const doc = code ? getDocument(code) : null;
  const latest = useLatestMessage();
  const on = useFeatures();
  let errors = 0,
    warnings = 0;
  for (const { path, items } of allProblems())
    if (!root || within(root, path))
      for (const d of items) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
  return (
    <div className="ide-status" role="status">
      {project?.git && on("sourceControl") && (
        <span
          className="ide-status-branch"
          title={`Git branch: ${project.git.branch}`}
        >
          <BranchIcon />
          <Label text={project.git.branch} />
        </span>
      )}
      {project && root && on("cmake") && (
        <CMakeStatus
          id={project.id}
          root={root}
          source={project.settings.cmake?.sourceDirectory ?? ""}
        />
      )}
      {project && root && on("analysis") && (
        <AnalysisStatus id={project.id} root={root} />
      )}
      {latest && (
        <button
          type="button"
          className="ide-status-message"
          title={`${latest} (Output → IDE)`}
          onClick={() => {
            dismissMessage();
            host().showPanel(root, "output", "IDE");
          }}
        >
          ⓘ {latest}
        </button>
      )}
      {doc && (
        <span
          className="ide-status-file"
          title="Line ending and encoding of the code file"
        >
          {doc.ending.toUpperCase()} · UTF-8{doc.bom ? " BOM" : ""}
        </span>
      )}
      <button
        type="button"
        className="ide-status-problems"
        onClick={() => host().showProblems(root)}
        aria-label={`Problems: ${errors} errors, ${warnings} warnings`}
      >
        ⊗ {errors} ⚠ {warnings}
      </button>
    </div>
  );
}

/** The latest clang-tidy run: progress with Cancel, then whether its findings are current. */
function AnalysisStatus({ id, root }: { id: string; root: string }) {
  const state = useAnalysis(id);
  if (!state?.status) return null;
  if (state.status === "running")
    return (
      <span className="ide-status-analysis" aria-label="Analysis">
        <span className="ide-status-task">
          clang-tidy {state.done}/{state.total || "…"}
        </span>
        <button
          type="button"
          title="Analysis: Cancel"
          aria-label="Cancel analysis"
          onClick={() => cancelAnalysis(id)}
        >
          ✕
        </button>
      </span>
    );
  const stale = allProblems().some(
    ({ path, items }) =>
      within(root, path) &&
      items.some((d) => d.source === "clang-tidy-cli" && d.stale),
  );
  const text =
    state.status === "failed"
      ? "clang-tidy failed"
      : state.status === "cancelled"
        ? "clang-tidy cancelled"
        : stale
          ? "clang-tidy: stale"
          : "clang-tidy: current";
  return (
    <button
      type="button"
      className={`ide-status-analysis ${state.status}${stale ? " stale" : ""}`}
      title={
        state.error ??
        (stale
          ? "Files or the build folder changed since the last analysis (Output → Analysis)"
          : "The last analysis (Output → Analysis)")
      }
      onClick={() => host().showPanel(root, "output", "Analysis")}
    >
      {text}
    </button>
  );
}

/** A choice's text, cut with an ellipsis when the bar is narrow (its title has it whole). */
function Label({ text }: { text: string }) {
  return <span className="ide-status-label">{text}</span>;
}

function CMakeStatus({
  id,
  root,
  source,
}: {
  id: string;
  root: string;
  source: string;
}) {
  const { info, task } = useCMake(id);
  const debug = useDebug();
  const on = useFeatures();
  const { kits } = useCMakeStore();
  useEffect(() => {
    void refresh(id);
  }, [id, root, source]);
  const cmake = choices(id);
  useEffect(() => {
    if (info?.cmake && !info.presets && cmake.kit)
      void loadKits().catch(() => {});
  }, [info?.cmake, info?.presets, cmake.kit]);
  if (!info?.cmake) return null;
  const act = (work: () => Promise<unknown>) => () =>
    void work().catch((e) => host().report(e));
  const kit =
    cmake.kit === "unspecified"
      ? "[Unspecified]"
      : cmake.kit
        ? (kits?.find((k) => k.id === cmake.kit)?.name ?? "Unknown kit")
        : "No kit";
  const preset =
    info.configurePresets.find((p) => p.name === cmake.configurePreset) ??
    info.configurePresets[0];
  const buildPreset = info.buildPresets.find(
    (p) => p.name === cmake.buildPreset,
  );
  return (
    <div className="ide-status-cmake" aria-label="CMake">
      {info.presets ? (
        <>
          <button
            type="button"
            title={`CMake: Select Configure Preset (${preset?.display ?? "No preset"})`}
            onClick={act(() => selectConfigurePreset(id))}
          >
            <PresetIcon />
            <Label text={preset?.display ?? "No preset"} />
          </button>
          {info.buildPresets.length > 0 && (
            <button
              type="button"
              title={`CMake: Select Build Preset (${buildPreset?.display ?? "[Default]"})`}
              onClick={act(() => selectBuildPreset(id))}
            >
              <PackageIcon />
              <Label text={buildPreset?.display ?? "[Default]"} />
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            title={`CMake: Select Kit (${kit})`}
            onClick={act(() => selectKit(id))}
          >
            <KitIcon />
            <Label text={kit} />
          </button>
          <button
            type="button"
            title={`CMake: Select Variant (${variantOf(cmake)})`}
            onClick={act(() => selectVariant(id))}
          >
            <Label text={variantOf(cmake)} />
          </button>
        </>
      )}
      {task ? (
        <>
          <span className="ide-status-task">{STEPS[task.step]}…</span>
          <button
            type="button"
            title="CMake: Cancel"
            aria-label="Cancel CMake task"
            onClick={() => cancel(id)}
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            title="CMake: Configure"
            onClick={act(() => configure(id))}
          >
            <GearIcon />
            Configure
          </button>
          <button
            type="button"
            title="CMake: Build"
            onClick={act(() => build(id))}
          >
            <BuildIcon />
            Build
          </button>
        </>
      )}
      <button
        type="button"
        title={`CMake: Select Build Target (${cmake.buildTarget ?? "all"})`}
        onClick={act(() => selectBuildTarget(id))}
      >
        <Label text={`[${cmake.buildTarget ?? "all"}]`} />
      </button>
      <button
        type="button"
        title="CMake: Run"
        aria-label="Run"
        disabled={!!task}
        onClick={act(() => run(id))}
      >
        ▶
      </button>
      {!on("debugging") ? null : debug.session?.project === id ? (
        <button
          type="button"
          className="ide-status-debugging"
          title="Debug: Stop"
          aria-label="Stop debugging"
          onClick={act(stopDebugging)}
        >
          ■ {debug.session.state === "stopped" ? "Paused" : "Debugging"}
        </button>
      ) : (
        <button
          type="button"
          title="Debug: Start Debugging (builds the run target first)"
          aria-label="Start Debugging"
          disabled={!!task || !!debug.session || debug.phase !== "idle"}
          onClick={act(() => startDebugging(id))}
        >
          ⛭
        </button>
      )}
      <button
        type="button"
        title={`CMake: Select Run Target (${cmake.runTarget ?? "no target"})`}
        onClick={act(() => selectRunTarget(id))}
      >
        <Label text={`[${cmake.runTarget ?? "no target"}]`} />
      </button>
    </div>
  );
}
