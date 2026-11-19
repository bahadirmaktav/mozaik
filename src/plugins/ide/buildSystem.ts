import {
  build as buildCMake,
  choices,
  cmakeInfo,
  refresh as refreshCMake,
  selectRunTarget as selectCMakeTarget,
} from "./cmake";
import {
  buildCargo,
  cargoChoices,
  isCargo,
  refreshCargo,
  selectRunTarget as selectCargoTarget,
} from "./cargo";
import { enabled } from "./features";

/**
 * What Run and Debug build and start: a CMake project's targets, or a Cargo project's
 * binaries and examples. A folder with both is a CMake project here (its Cargo commands
 * still work from the palette).
 */
export type System = "cmake" | "cargo";

/** The project's build system, from what is known now (null: neither, or not read yet). */
export function systemOf(id: string): System | null {
  if (enabled("cmake") && cmakeInfo(id)?.cmake) return "cmake";
  if (enabled("cargo") && isCargo(id)) return "cargo";
  return null;
}
/** The build system after reading the folder if it was not read yet. */
export async function readSystem(id: string): Promise<System | null> {
  if (enabled("cmake") && !cmakeInfo(id)) await refreshCMake(id);
  if (enabled("cargo") && isCargo(id) === null) await refreshCargo(id);
  return systemOf(id);
}
export const runTargetOf = (id: string, system: System) =>
  system === "cargo" ? cargoChoices(id).runTarget : choices(id).runTarget;
export const selectRunTargetOf = (id: string, system: System) =>
  system === "cargo" ? selectCargoTarget(id) : selectCMakeTarget(id);
export const buildTargetOf = (id: string, system: System, target: string) =>
  system === "cargo" ? buildCargo(id, target) : buildCMake(id, target);
/** Where a build's output shows. */
export const outputOf = (system: System) =>
  system === "cargo" ? "Cargo" : "CMake";
