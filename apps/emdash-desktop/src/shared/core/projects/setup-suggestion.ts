/**
 * A suggested setup (lifecycle) command derived from the tooling detected in a
 * project's repository root. Surfaced to the user when they enter a project that
 * has no `scripts.setup` configured yet, so they can adopt it in one click.
 */
export type SetupScriptSuggestion = {
  /** Stable identifier of the detected ecosystem, e.g. 'bun', 'pnpm', 'cargo'. */
  tool: string;
  /** Human-friendly ecosystem name shown in the UI, e.g. 'Bun', 'Cargo'. */
  displayName: string;
  /** Suggested command to populate `scripts.setup`, e.g. 'bun install'. */
  command: string;
};
