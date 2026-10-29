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
import { allProblems, host, useEditors } from "./editors";
import { useStatus } from "./panels";
import { within } from "./paths";
import { useProject } from "./projects";

const STEPS = {
  configure: "Configuring",
  reconfigure: "Configuring",
  build: "Building",
  clean: "Cleaning",
  cleanRebuild: "Building",
};

/** The IDE's status bar: Git branch, CMake choices and actions, problem counts. */
export default function Status({ instanceId }: ViewProps) {
  const project = useProject(useStatus(instanceId) ?? "");
  useEditors();
  const root = project?.root ?? null;
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
      {project?.git && (
        <span className="ide-status-branch" title="Git branch">
          ⎇ {project.git.branch}
        </span>
      )}
      {project && root && (
        <CMakeStatus
          id={project.id}
          root={root}
          source={project.settings.cmake?.sourceDirectory ?? ""}
        />
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
            title="CMake: Select Configure Preset"
            onClick={act(() => selectConfigurePreset(id))}
          >
            ⚙ {preset?.display ?? "No preset"}
          </button>
          {info.buildPresets.length > 0 && (
            <button
              type="button"
              title="CMake: Select Build Preset"
              onClick={act(() => selectBuildPreset(id))}
            >
              {buildPreset?.display ?? "[Default]"}
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            title="CMake: Select Kit"
            onClick={act(() => selectKit(id))}
          >
            ⚙ {kit}
          </button>
          <button
            type="button"
            title="CMake: Select Variant"
            onClick={act(() => selectVariant(id))}
          >
            {variantOf(cmake)}
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
            Configure
          </button>
          <button
            type="button"
            title="CMake: Build"
            onClick={act(() => build(id))}
          >
            ⚒ Build
          </button>
        </>
      )}
      <button
        type="button"
        title="CMake: Select Build Target"
        onClick={act(() => selectBuildTarget(id))}
      >
        [{cmake.buildTarget ?? "all"}]
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
      <button
        type="button"
        title="CMake: Select Run Target"
        onClick={act(() => selectRunTarget(id))}
      >
        [{cmake.runTarget ?? "no target"}]
      </button>
    </div>
  );
}
