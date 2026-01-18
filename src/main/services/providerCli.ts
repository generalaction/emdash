import path from 'path';
import { PROVIDERS, type ProviderDefinition } from '@shared/providers/registry';

export function detectProviderFromShellCommand(shellCommand: string | undefined): ProviderDefinition | undefined {
  if (!shellCommand) return undefined;

  const base = path.basename(shellCommand).toLowerCase();
  const baseNoExt = base.replace(/\.(exe|cmd|bat|com)$/i, '');
  if (!baseNoExt) return undefined;

  return PROVIDERS.find((p) => (p.cli || '').toLowerCase() === baseNoExt);
}

export function buildProviderCliArgs(
  provider: ProviderDefinition,
  options: {
    autoApprove?: boolean;
    initialPrompt?: string;
    skipResume?: boolean;
  }
): string[] {
  const { autoApprove, initialPrompt, skipResume } = options;
  const cliArgs: string[] = [];

  if (provider.resumeFlag && !skipResume) {
    cliArgs.push(...provider.resumeFlag.split(' ').filter(Boolean));
  }

  if (provider.defaultArgs?.length) {
    cliArgs.push(...provider.defaultArgs);
  }

  if (autoApprove && provider.autoApproveFlag) {
    cliArgs.push(provider.autoApproveFlag);
  }

  if (provider.initialPromptFlag !== undefined && initialPrompt?.trim()) {
    if (provider.initialPromptFlag) {
      cliArgs.push(provider.initialPromptFlag);
    }
    cliArgs.push(initialPrompt.trim());
  }

  return cliArgs;
}

