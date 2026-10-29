import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { native } from "../../services/native";

interface ShellChoices {
  shells: { id: string; name: string }[];
  selected: string | null;
  system: string | null;
}
export function ShellSetting({ report }: { report: (e: unknown) => void }) {
  const [choices, setChoices] = useState<ShellChoices | null>(null);
  useEffect(() => {
    if (isTauri())
      void native<ShellChoices>("terminal_shells")
        .then(setChoices)
        .catch(report);
  }, []);
  if (!isTauri())
    return <p className="muted">Shell selection requires the desktop app.</p>;
  if (!choices) return <p className="muted">Detecting shells…</p>;
  const value = choices.selected ?? choices.system ?? "";
  const missing =
    choices.selected && !choices.shells.some((s) => s.id === choices.selected);
  return (
    <>
      <label>
        Default shell{" "}
        <select
          value={value}
          onChange={(e) => {
            const shell = e.target.value;
            void native("set_default_shell", { shell })
              .then(() => setChoices({ ...choices, selected: shell }))
              .catch(report);
          }}
        >
          {missing && (
            <option value={value} disabled>
              Missing: {value}
            </option>
          )}
          {choices.shells.map((shell) => (
            <option key={shell.id} value={shell.id} title={shell.id}>
              {shell.name}
              {shell.id === choices.system ? " (system default)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        {missing
          ? "Not installed any more: choose another."
          : "For new terminals."}
      </p>
    </>
  );
}
