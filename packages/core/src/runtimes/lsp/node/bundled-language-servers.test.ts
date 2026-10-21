import { expect, it } from 'vitest';
import { unpackedPath } from './bundled-language-servers';

it.each([
  [
    '/Applications/Emdash.app/Contents/Resources/app.asar/node_modules/typescript/lib/tsserver.js',
    '/Applications/Emdash.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/lib/tsserver.js',
  ],
  [
    String.raw`C:\Emdash\resources\app.asar\node_modules\typescript\lib\tsserver.js`,
    String.raw`C:\Emdash\resources\app.asar.unpacked\node_modules\typescript\lib\tsserver.js`,
  ],
  [
    '/opt/emdash/node_modules/typescript/lib/tsserver.js',
    '/opt/emdash/node_modules/typescript/lib/tsserver.js',
  ],
])('resolves physical language-server assets at %s', (input, output) => {
  expect(unpackedPath(input)).toBe(output);
});
