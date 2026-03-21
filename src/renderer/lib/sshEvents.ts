export const SSH_CONNECTION_RESTORED_EVENT = 'emdash:ssh-connection-restored';

export interface SshConnectionRestoredDetail {
  connectionId: string;
  projectId?: string;
}

export function dispatchSshConnectionRestored(detail: SshConnectionRestoredDetail): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SshConnectionRestoredDetail>(SSH_CONNECTION_RESTORED_EVENT, {
      detail,
    })
  );
}
