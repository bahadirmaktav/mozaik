import type { ComponentType } from "react";
import type { Minimum } from "../../workspace/model";

export type ViewProps = { instanceId: string; focused: boolean };
export interface PluginDefinition {
  id: string;
  name: string;
  minimum: Minimum;
  create(): string;
  loadView(): Promise<{ default: ComponentType<ViewProps> }>;
  title(instanceId: string): string;
  modified(instanceId: string): boolean;
  // Notifies when titles or modified state may have changed.
  subscribe(listener: () => void): () => void;
  beforeClose(instanceId: string): boolean;
  dispose(instanceId: string): void;
}
