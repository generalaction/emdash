function isAbsoluteCommand(command: string): boolean {
  return command.startsWith('/') || /^[A-Za-z]:[\\/]/.test(command);
}

function basename(command: string): string {
  const index = command.lastIndexOf('/');
  return index >= 0 ? command.slice(index + 1) : command;
}

export function joinInstallPath(installPath: string, command: string): string {
  const trimmedPath = installPath.trim();
  if (!trimmedPath || isAbsoluteCommand(command)) return command;

  const separator = /^[A-Za-z]:[\\/]/.test(trimmedPath) || trimmedPath.includes('\\') ? '\\' : '/';
  return `${trimmedPath.replace(/[\\/]+$/, '')}${separator}${basename(command)}`;
}
