import type { AppDb } from '@main/db/client';
import { baseline } from './baseline';
import { empty } from './empty';

export type SeedFn = (db: AppDb) => Promise<void>;

export const seeds: Record<string, SeedFn> = {
  empty,
  baseline,
};
