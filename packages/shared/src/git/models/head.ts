export type GitHeadModel =
  | { kind: 'branch'; name: string }
  | { kind: 'detached'; shortHash: string }
  | { kind: 'unborn'; name: string };
