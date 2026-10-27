export function repositoryNameError(provider: 'github' | 'gitlab', name: string): string | null {
  if (provider === 'gitlab' && name.includes('/')) {
    return 'Project creation is limited to existing groups and subgroups. Select one in Owner and enter only the project name here.';
  }
  return null;
}
