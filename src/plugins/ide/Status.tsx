import type { ViewProps } from "../contract";
import { host, useEditors } from "./editors";
import { useStatus } from "./panels";
import { within } from "./paths";
import { useProject } from "./projects";

/** The IDE's status bar: the project's Git branch and its problem counts. */
export default function Status({ instanceId }: ViewProps) {
  const project = useProject(useStatus(instanceId) ?? "");
  const { diagnostics } = useEditors();
  const root = project?.root ?? null;
  let errors = 0,
    warnings = 0;
  for (const { path, items } of diagnostics.values())
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
