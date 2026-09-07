export type NativeInvocation =
  | {
      kind: 'argv';
      executable: string;
      argv: readonly string[];
    }
  | {
      kind: 'windows-command-line';
      executable: string;
      /** Preformatted arguments only, excluding the executable. Treat as opaque after creation. */
      rawArguments: string;
    };
