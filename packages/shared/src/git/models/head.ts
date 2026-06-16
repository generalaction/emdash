export type GitHeadModel =
  | { kind: 'branch'; name: string; oid: string }
  | { kind: 'detached'; shortHash: string; oid: string }
  | { kind: 'unborn'; name: string };
