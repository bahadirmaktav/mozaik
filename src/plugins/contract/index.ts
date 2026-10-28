import type { ComponentType } from 'react';
import type { Minimum } from '../../workspace/model';

export type ViewProps = { instanceId: string };
export interface PluginDefinition {
  id: string;
  name: string;
  minimum: Minimum;
  create(): string;
  loadView(): Promise<{ default: ComponentType<ViewProps> }>;
  beforeClose(instanceId: string): boolean;
  dispose(instanceId: string): void;
}
