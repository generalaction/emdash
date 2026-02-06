import { useEffect, useMemo, useState, useCallback } from 'react';

type DownloadProgress = { percent?: number; transferred?: number; total?: number };

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info?: any }
  | { status: 'not-available' }
  | { status: 'downloading'; progress?: DownloadProgress }
  | { status: 'downloaded' }
  | { status: 'error'; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    const off = window.electronAPI?.onUpdateEvent?.((evt) => {
      switch (evt.type) {
        case 'checking':
          setState({ status: 'checking' });
          break;
        case 'available':
          setState({ status: 'available', info: evt.payload });
          break;
        case 'not-available':
          setState({ status: 'not-available' });
          break;
        case 'downloading':
          setState({ status: 'downloading' });
          break;
        case 'download-progress':
          setState({ status: 'downloading', progress: evt.payload });
          break;
        case 'downloaded':
          setState({ status: 'downloaded' });
          break;
        case 'error':
          setState({ status: 'error', message: evt.payload?.message || 'Update error' });
          break;
        default:
          break;
      }
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, []);

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    const res: any = await window.electronAPI?.checkForUpdates?.();
    if (!res) {
      setState({ status: 'error', message: 'Update API unavailable' });
      return { success: false, error: 'Update API unavailable' };
    }
    if (!res.success) {
      const hint = res?.devDisabled
        ? 'Updates are disabled in development.'
        : res.error || 'Failed to check for updates';
      setState({ status: 'error', message: hint });
    }
    return res;
  }, []);

  const download = useCallback(async () => {
    // Don't change state to downloading immediately - wait for backend confirmation
    const res: any = await window.electronAPI?.downloadUpdate?.();
    if (!res) {
      setState({ status: 'error', message: 'Update API unavailable' });
      return { success: false, error: 'Update API unavailable' };
    }
    if (!res.success) {
      const hint = res?.devDisabled
        ? 'Cannot download updates in development unless EMDASH_DEV_UPDATES=true is set.'
        : res.error || 'Failed to download update';
      setState({ status: 'error', message: hint });
    }
    return res;
  }, []);

  const install = useCallback(async () => {
    return window.electronAPI?.quitAndInstallUpdate?.();
  }, []);

  const openLatest = useCallback(async () => {
    return window.electronAPI?.openLatestDownload?.();
  }, []);

  const progressLabel = useMemo(() => {
    if (state.status !== 'downloading') return '';
    const p = state.progress?.percent ?? 0;
    return `${p.toFixed(0)}%`;
  }, [state]);

  return { state, check, download, install, openLatest, progressLabel };
}
