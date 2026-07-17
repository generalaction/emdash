import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve(import.meta.dirname, '..', '..', 'emdash-mobile', 'dist');
const target = resolve(import.meta.dirname, '..', 'out', 'mobile');

const sourceStat = await stat(source).catch(() => null);
if (!sourceStat?.isDirectory()) {
  throw new Error(`Mobile build output is missing: ${source}`);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
