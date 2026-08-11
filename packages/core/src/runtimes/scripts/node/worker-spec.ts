import type { WireComponentWorkerCreateOptions } from '@emdash/wire/worker';
import { scriptsComponent } from './component';

type ScriptsWorkerOptions = WireComponentWorkerCreateOptions<
  (typeof scriptsComponent)['requirements'],
  Record<string, never>
>;

export type ScriptsWorkerSpecInput = {
  executable: string;
  env: NodeJS.ProcessEnv;
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
      config: {},
    },
  ];
}
