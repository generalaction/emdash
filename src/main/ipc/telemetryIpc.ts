import { ipcMain } from 'electron';
import {
  capture,
  isTelemetryEnabled,
  getTelemetryStatus,
  setTelemetryEnabledViaUser,
  setSessionRecordingOptIn,
} from '../telemetry';

export function registerTelemetryIpc() {
  ipcMain.handle('telemetry:capture', async (_event, args: { event: string; properties?: any }) => {
    try {
      if (!isTelemetryEnabled()) return { success: false, disabled: true };
      const ev = String(args?.event || '') as any;
      const allowed = new Set(['feature_used', 'error']);
      if (!allowed.has(ev)) return { success: false, error: 'event_not_allowed' };
      const props =
        args?.properties && typeof args.properties === 'object' ? args.properties : undefined;
      capture(ev, props);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'capture_failed' };
    }
  });

  ipcMain.handle('telemetry:get-status', async () => {
    try {
      return { success: true, status: getTelemetryStatus() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'status_failed' };
    }
  });

  ipcMain.handle('telemetry:set-enabled', async (_event, enabled: boolean) => {
    try {
      setTelemetryEnabledViaUser(Boolean(enabled));
      return { success: true, status: getTelemetryStatus() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'update_failed' };
    }
  });

  ipcMain.handle('telemetry:set-session-recording', async (_event, enabled: boolean) => {
    try {
      setSessionRecordingOptIn(Boolean(enabled));
      return { success: true, status: getTelemetryStatus() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'update_failed' };
    }
  });
}
