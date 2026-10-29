import { useEffect, useRef } from "react";
import type { ViewProps } from "../contract";
import { native } from "../../services/native";
import { getSession, hasSession, useTerminalSession } from "./sessions";
import { attach, focus, start } from "./runtime";

export default function TerminalView({ instanceId, focused }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const session = useTerminalSession(instanceId);
  useEffect(() => {
    const view = attach(instanceId, host.current!);
    void start(
      instanceId,
      hasSession(instanceId) ? getSession(instanceId).request : null,
    );
    return () => view.detach();
  }, [instanceId]);
  useEffect(() => {
    if (focused) focus(instanceId);
  }, [focused, instanceId]);
  async function startSystemShell() {
    const choices = await native<{ system: string | null }>("terminal_shells");
    if (choices.system) await start(instanceId, choices.system);
  }
  return (
    <div className="terminal-wrapper">
      {session?.status === "failed" && (
        <div className="terminal-error" role="alert">
          <span>{session.error}</span>
          {session.error?.includes("no longer available") && (
            <button onClick={() => void startSystemShell().catch(() => {})}>
              Start system default shell
            </button>
          )}
        </div>
      )}
      <div className="terminal-host" ref={host} />
    </div>
  );
}
