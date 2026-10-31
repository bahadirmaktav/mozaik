import { native } from "../../services/native";

export interface ShellChoices {
  shells: { id: string; name: string }[];
  selected: string | null;
  system: string | null;
}
/** The detected shells; browser tests replace `load`. */
export const shellBackend = {
  load: () => native<ShellChoices>("terminal_shells"),
};
export const loadShells = () => shellBackend.load();

/** The default shell of the settings draft; `value` null is the system default. */
export function ShellSetting({
  choices,
  value,
  onChange,
}: {
  choices: ShellChoices | null;
  value: string | null;
  onChange: (shell: string) => void;
}) {
  if (!choices) return <p className="muted">Detecting shells…</p>;
  const shown = value ?? choices.system ?? "";
  const missing = value && !choices.shells.some((s) => s.id === value);
  return (
    <>
      <select
        aria-label="Default shell"
        value={shown}
        onChange={(e) => onChange(e.target.value)}
      >
        {missing && (
          <option value={shown} disabled>
            Missing: {shown}
          </option>
        )}
        {choices.shells.map((shell) => (
          <option key={shell.id} value={shell.id} title={shell.id}>
            {shell.name}
            {shell.id === choices.system ? " (system default)" : ""}
          </option>
        ))}
      </select>
      {missing && (
        <p className="settings-warning">
          Not installed any more: choose another.
        </p>
      )}
    </>
  );
}
