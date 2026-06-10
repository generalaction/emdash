export type CommandContext = {
  cli: string; // absolute path to the cli binary
  extraArgs?: string[]; // user-configured in settings
  autoApprove: boolean;
  initialPrompt?: string;
  /** Emdash conversation UUID — used as the session token for providers that track their
   * own session across the emdash lifetime (e.g. claude --session-id, opencode --session). */
  sessionId?: string;
  /** Provider-native session identifier stored by the agent classifier. When present, used
   * for resume on providers that generate their own session IDs (e.g. grok, copilot, kimi,
   * codex, droid). Undefined means the provider has not yet emitted a session ID. */
  providerSessionId?: string;
  isResuming?: boolean;
  model: string;
};

export type AgentCommand = {
  command: string;
  args: string[];
  env: Record<string, string>;
};
