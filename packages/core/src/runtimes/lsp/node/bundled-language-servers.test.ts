import { expect, it } from 'vitest';
import { unpackedPath } from './bundled-language-servers';

it.each([
  [
    '/Applications/Agent.app/Contents/Resources/app.asar/node_modules/typescript/lib/tsserver.js',
    '/Applications/Agent.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/lib/tsserver.js',
  ],
  [
    String.raw`C:\Agent\resources\app.asar\node_modules\typescript\lib\tsserver.js`,
    String.raw`C:\Agent\resources\app.asar.unpacked\node_modules\typescript\lib\tsserver.js`,
  ],
  [
    '/opt/agent/node_modules/typescript/lib/tsserver.js',
    '/opt/agent/node_modules/typescript/lib/tsserver.js',
  ],
])('resolves physical language-server assets at %s', (input, output) => {
  expect(unpackedPath(input)).toBe(output);
});
