import { useEffect, useRef, useState } from "react";
import type { ViewProps } from "../contract";
import { native } from "../../services/native";
import { getSession, hasSession, useTerminalSession } from "./sessions";
import { attach, focus, setKeys, start } from "./runtime";
import { TerminalFind, type TerminalFindHandle } from "./TerminalFind";
import { matches } from "../../workspace/keybindings";

/** `find`: the IDE's terminals take Ctrl+F for their Find, as VS Code's do. */
export default function TerminalView({
  instanceId,
  focused,
  find = false,
}: ViewProps & { find?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const finder = useRef<TerminalFindHandle>(null);
  const [finding, setFinding] = useState(false);
  const findingRef = useRef(finding);
  findingRef.current = finding;
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
    if (!find) return;
    setKeys(instanceId, (event) => {
      if (matches(event, "terminal.find")) {
        event.preventDefault();
        finder.current?.open();
        return true;
      }
      if (event.key === "Escape" && findingRef.current) {
        finder.current?.close();
        return true;
      }
      return false;
    });
    return () => setKeys(instanceId, null);
  }, [find, instanceId]);
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
      {find && (
        <TerminalFind
          ref={finder}
          id={instanceId}
          shown={finding}
          onShown={setFinding}
        />
      )}
      <div className="terminal-host" ref={host} />
    </div>
  );
}
