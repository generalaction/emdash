import type { ProvidedWireComponentRequirements } from '@emdash/wire/worker';
import type { WireComponentWorkerCreateOptions } from '@emdash/wire/worker';
import type { z } from 'zod';
import { type automationsComponentConfigSchema, createAutomationsComponent } from './component';

type AutomationsComponent = ReturnType<typeof createAutomationsComponent>;
type AutomationsWorkerOptions = WireComponentWorkerCreateOptions<
  AutomationsComponent['requirements'],
  z.infer<typeof automationsComponentConfigSchema>
>;

export type AutomationsWorkerSpecInput = {
  executable: string;
  env: NodeJS.ProcessEnv;
  dependencies: ProvidedWireComponentRequirements<AutomationsComponent['requirements']>;
  dbFile: string;
};

/**
 * Spawn spec for the automations runtime worker. It spawns last: it drives the
 * workspace-registry plane and reports into the session runtimes. The 3s
 * shutdown grace lets in-flight run bookkeeping reach its database before the
 * host escalates.
 */
export function automationsWorkerSpec(
  input: AutomationsWorkerSpecInput
): readonly [AutomationsComponent, AutomationsWorkerOptions] {
  return [
    createAutomationsComponent(),
    {
      name: 'automations',
      executable: input.executable,
      env: input.env,
      dependencies: input.dependencies,
      config: { dbFile: input.dbFile },
      shutdownGraceMs: 3_000,
    },
  ];
}
