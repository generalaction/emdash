import type { WireComponentWorkerCreateOptions } from '@emdash/wire/worker';
import type { z } from 'zod';
import { scriptsComponent, type scriptsComponentConfigSchema } from './component';

type ScriptsWorkerOptions = WireComponentWorkerCreateOptions<
  (typeof scriptsComponent)['requirements'],
  z.infer<typeof scriptsComponentConfigSchema>
>;

export type ScriptsWorkerSpecInput = {
  executable: string;
  env: NodeJS.ProcessEnv;
  userEnv: Record<string, string>;
};

/** Spawn spec for the scripts worker. */
export function scriptsWorkerSpec(
  input: ScriptsWorkerSpecInput
): readonly [typeof scriptsComponent, ScriptsWorkerOptions] {
  return [
    scriptsComponent,
    {
      name: 'scripts',
      executable: input.executable,
      env: input.env,
      dependencies: {},
      config: { userEnv: input.userEnv },
    },
  ];
}
