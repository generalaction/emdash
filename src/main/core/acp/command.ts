import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { parseShellWords } from '../conversations/impl/agent-command';

export type AcpCommand = {
  command: string;
  args: string[];
};

const SHELL_SYNTAX_ERROR = 'ACP commands support executable command prefixes only.';

export function resolveAcpCommand(
  providerId: AgentProviderId,
  providerConfig: ProviderCustomConfig | undefined
): AcpCommand {
  const configured = providerConfig?.acpCommand;
  if (!configured?.length) {
    throw new Error(`Missing ACP command for provider: ${providerId}`);
  }

  const [command, ...args] = configured;
  if (!command?.trim()) throw new Error(`Missing ACP command for provider: ${providerId}`);
  rejectShellSyntax(command);
  for (const arg of args) rejectNulByte(arg);
  return { command, args };
}

export function parseAcpCommandField(value: string): string[] {
  const parsed = parseShellWords(value, { rejectShellSyntax: true });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.words;
}

function rejectShellSyntax(value: string): void {
  rejectNulByte(value);
  const parsed = parseShellWords(value, { rejectShellSyntax: true });
  if (!parsed.ok || parsed.words.length !== 1 || parsed.words[0] !== value) {
    throw new Error(SHELL_SYNTAX_ERROR);
  }
}

function rejectNulByte(value: string): void {
  if (value.includes('\0')) throw new Error('ACP command contains an invalid NUL byte.');
}
