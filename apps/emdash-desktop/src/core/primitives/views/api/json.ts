export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue | undefined }
  | readonly JsonValue[];

export type JsonObject = { readonly [key: string]: JsonValue | undefined };
