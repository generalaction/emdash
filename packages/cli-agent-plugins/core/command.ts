export type CommandContext = {
  cli: string; // abosolute path to the cli binary
  extraArgs?: string[]; // user-configured in settings
  autoApprove: boolean;
  initialPrompt?: string;
  sessionId?: string;
  isResuming?: boolean;
  model: string;
};

export type AgentCommand = {
  command: string;
  args: string[];
  env: Record<string, string>;
};
