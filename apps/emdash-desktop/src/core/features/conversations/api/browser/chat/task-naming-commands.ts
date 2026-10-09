import type { CommandItem } from '@emdash/ui/react/components';

type ProviderCommand = Pick<CommandItem, 'name' | 'description'>;

function commandName(name: string): string {
  return name.replace(/^\//, '').toLowerCase();
}

function hasNativeRename(commands: readonly ProviderCommand[]): boolean {
  return commands.some(({ name }) => commandName(name) === 'rename');
}

export function withTaskNamingCommands(commands: readonly ProviderCommand[]): CommandItem[] {
  const names = hasNativeRename(commands) ? ['rename-task'] : ['rename-task', 'rename'];
  const localCommands: CommandItem[] = names.map((name) => ({
    id: name,
    name,
    description: 'Name this task with the current conversation AI (Emdash).',
    behavior: 'insert',
  }));
  return [
    ...localCommands,
    ...commands
      .filter(({ name }) => commandName(name) !== 'rename-task')
      .map(({ name, description }) => ({
        id: name,
        name,
        description,
        behavior: 'insert' as const,
      })),
  ];
}

export function isTaskNamingCommand(text: string, commands: readonly ProviderCommand[]): boolean {
  if (/[\r\n]/.test(text)) return false;
  const command = text.trim();
  return command === '/rename-task' || (command === '/rename' && !hasNativeRename(commands));
}
