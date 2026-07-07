import type { z } from 'zod';

export type LiveModelRef<
  Id extends string = string,
  KeySchema extends z.ZodTypeAny = z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  id: Id;
  keySchema: KeySchema;
  dataSchema: DataSchema;
};

export type LiveModelKey<Ref extends LiveModelRef> = z.infer<Ref['keySchema']>;

export type LiveModelData<Ref extends LiveModelRef> = z.infer<Ref['dataSchema']>;

export function liveModelRef<
  Id extends string,
  KeySchema extends z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny,
>(id: Id, keySchema: KeySchema, dataSchema: DataSchema): LiveModelRef<Id, KeySchema, DataSchema> {
  return { id, keySchema, dataSchema };
}
