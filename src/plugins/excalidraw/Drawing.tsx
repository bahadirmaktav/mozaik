import { useEffect, useRef, useState } from "react";
import type { ViewProps } from "../contract";
import { Dialog } from "../../components/Dialog";
import { drawingsBackend } from "../../services/drawings";
import {
  dirty,
  getDrawing,
  reloadDrawing,
  reportError,
  saveDrawing,
  useDrawing,
} from "./drawings";
import { attach, focus } from "./runtime";

export default function DrawingView({ instanceId, focused }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const drawing = useDrawing(instanceId);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => {
    const view = attach(instanceId, host.current!);
    return () => view.detach();
  }, [instanceId]);
  useEffect(() => {
    if (focused) focus(instanceId);
  }, [focused, instanceId]);
  const save = (as: boolean) =>
    void saveDrawing(instanceId, as).catch(reportError);
  async function reload() {
    setConfirmReload(false);
    const path = getDrawing(instanceId).path;
    if (path) reloadDrawing(instanceId, await drawingsBackend.read(path));
  }
  return (
    <div className="drawing-wrapper">
      {drawing?.conflict ? (
        <div className="drawing-alert" role="alert">
          <span>{drawing.conflict}</span>
          <button onClick={() => save(true)}>Save As</button>
          <button
            onClick={() =>
              dirty(getDrawing(instanceId))
                ? setConfirmReload(true)
                : void reload().catch(reportError)
            }
          >
            Reload
          </button>
        </div>
      ) : (
        drawing?.error && (
          <div className="drawing-alert" role="alert">
            <span>Not saved: {drawing.error}</span>
            <button onClick={() => save(false)}>Retry</button>
            <button onClick={() => save(true)}>Save As</button>
          </div>
        )
      )}
      <div className="drawing-host" ref={host} />
      {drawing && (
        <div className="editor-status" role="group" aria-label="Drawing status">
          <span>
            {drawing.path
              ? `Autosave · ${drawing.saving ? "Saving…" : drawing.conflict || drawing.error ? "Not saved" : dirty(drawing) ? "Modified" : "Saved"}`
              : `Not saved yet${dirty(drawing) ? " · Modified" : ""}`}
          </span>
        </div>
      )}
      {confirmReload && (
        <Dialog title="Reload drawing" onCancel={() => setConfirmReload(false)}>
          <p>Discard your unsaved changes and load the version on disk?</p>
          <div className="dialog-actions">
            <button onClick={() => void reload().catch(reportError)}>
              Reload
            </button>
            <button onClick={() => setConfirmReload(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
