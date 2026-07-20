let userDataConfigured = false;

export function markUserDataConfigured(): void {
  userDataConfigured = true;
}

export function assertUserDataConfigured(): void {
  const processType = (process as NodeJS.Process & { type?: string }).type;
  const isElectronMain = Boolean(process.versions.electron) && processType === 'browser';
  if (isElectronMain && !userDataConfigured) {
    throw new Error(
      'The database path was resolved before the Electron userData path was configured.'
    );
  }
}
