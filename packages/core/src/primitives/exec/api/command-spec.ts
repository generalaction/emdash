/** Explicit execution semantics, independent of whether the process uses a PTY or pipes. */
export type CommandSpec =
  | { kind: 'argv'; command: string; args: string[] }
  | { kind: 'shell-line'; commandLine: string };
