import type { ProvidedWireComponentRequirements } from '@emdash/wire/component';
import type { WireComponentWorkerCreateOptions } from '@emdash/wire/worker';
import type { z } from 'zod';
import { workspaceHostComponent, type workspaceHostComponentConfigSchema } from './component';

type WorkspaceHostWorkerOptions = WireComponentWorkerCreateOptions<
  (typeof workspaceHostComponent)['requirements'],
  z.infer<typeof workspaceHostComponentConfigSchema>
>;

export type WorkspaceHostWorkerSpecInput = {
  executable: string;
  env: NodeJS.ProcessEnv;
  dependencies: ProvidedWireComponentRequirements<(typeof workspaceHostComponent)['requirements']>;
  stateDirectory: string;
};

/**
 * Spawn spec for the workspace-host worker. Supervision `restart: 'never'` is
 * deliberate: workspace init progress and notices live in worker memory, so a
 * silently restarted worker would come back empty behind live client handles —
 * the embedding app owns recovery.
 */
export function workspaceHostWorkerSpec(
  input: WorkspaceHostWorkerSpecInput
): readonly [typeof workspaceHostComponent, WorkspaceHostWorkerOptions] {
  return [
    workspaceHostComponent,
    {
      name: 'workspace-host',
      executable: input.executable,
      env: input.env,
      dependencies: input.dependencies,
      config: { stateDirectory: input.stateDirectory },
      supervision: { restart: 'never' },
    },
  ];
}
