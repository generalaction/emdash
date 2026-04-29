import { randomUUID } from 'node:crypto';
import { isUniqueConstraintError } from './helpers';

export type InsertWithRegeneratedIdResult = {
  inserted: boolean;
  id: string;
  error?: unknown;
};

export async function insertWithRegeneratedId(args: {
  initialId: string;
  existingIds: ReadonlySet<string>;
  uniqueConstraintDetail: string;
  setId: (id: string) => void;
  insert: () => Promise<unknown>;
}): Promise<InsertWithRegeneratedIdResult> {
  let nextId = args.existingIds.has(args.initialId) ? randomUUID() : args.initialId;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      args.setId(nextId);
      await args.insert();
      return { inserted: true, id: nextId };
    } catch (error) {
      if (attempt === 0 && isUniqueConstraintError(error, args.uniqueConstraintDetail)) {
        nextId = randomUUID();
        continue;
      }
      return { inserted: false, id: nextId, error };
    }
  }

  return { inserted: false, id: nextId };
}
