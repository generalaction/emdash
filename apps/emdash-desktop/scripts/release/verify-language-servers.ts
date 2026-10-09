import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyPackagedLanguageServers } from './lib/packaged-language-servers.ts';

const { values } = parseArgs({
  options: { executable: { type: 'string' }, resources: { type: 'string' } },
  strict: true,
});
if (!values.executable || !values.resources)
  throw new Error(
    'Usage: verify-language-servers.ts --executable <app executable> --resources <resources directory>'
  );
await verifyPackagedLanguageServers({
  executable: resolve(values.executable),
  resourcesDirectory: resolve(values.resources),
});
console.log(
  'Packaged TypeScript and Pyright verified with an empty PATH, including standard libraries.'
);
