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
