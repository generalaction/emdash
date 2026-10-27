import type {
  ProvidedWireComponentRequirements,
  WireComponentWorkerCreateOptions,
} from '@emdash/wire/worker';
import { lspComponent } from './component';

export function lspWorkerSpec(input: {
  executable: string;
  env: NodeJS.ProcessEnv;
  dependencies: ProvidedWireComponentRequirements<typeof lspComponent.requirements>;
}): readonly [
  typeof lspComponent,
  WireComponentWorkerCreateOptions<typeof lspComponent.requirements, Record<string, never>>,
] {
  return [
    lspComponent,
    {
      name: 'lsp',
      executable: input.executable,
      env: input.env,
      dependencies: input.dependencies,
      config: {},
    },
  ];
}
