import React, { useEffect, useState } from 'react';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const UpdateSettingsCard: React.FC = () => {
  const [autoCheck, setAutoCheck] = useState(true);
  const [autoDownload, setAutoDownload] = useState(false);
  const [checkIntervalHours, setCheckIntervalHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (cancelled) return;
        if (result.success && result.settings) {
          setAutoCheck(result.settings.updates?.autoCheck ?? true);
          setAutoDownload(result.settings.updates?.autoDownload ?? false);
          setCheckIntervalHours(result.settings.updates?.checkIntervalHours ?? 24);
        }
      } catch (error) {
        console.error('Failed to load update settings:', error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAutoCheck = async (next: boolean) => {
    const previous = autoCheck;
    setAutoCheck(next);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        updates: { autoCheck: next, autoDownload, checkIntervalHours },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      // Update from server response
      if (result.settings?.updates) {
        setAutoCheck(result.settings.updates.autoCheck ?? next);
        setAutoDownload(result.settings.updates.autoDownload ?? autoDownload);
        setCheckIntervalHours(result.settings.updates.checkIntervalHours ?? checkIntervalHours);
      }
    } catch (error) {
      console.error('Failed to update auto-check setting:', error);
      setAutoCheck(previous);
    } finally {
      setSaving(false);
    }
  };

  const updateAutoDownload = async (next: boolean) => {
    const previous = autoDownload;
    setAutoDownload(next);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        updates: { autoCheck, autoDownload: next, checkIntervalHours },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      // Update from server response
      if (result.settings?.updates) {
        setAutoCheck(result.settings.updates.autoCheck ?? autoCheck);
        setAutoDownload(result.settings.updates.autoDownload ?? next);
        setCheckIntervalHours(result.settings.updates.checkIntervalHours ?? checkIntervalHours);
      }
    } catch (error) {
      console.error('Failed to update auto-download setting:', error);
      setAutoDownload(previous);
    } finally {
      setSaving(false);
    }
  };

  const updateCheckInterval = async (value: string) => {
    const next = Number(value);
    const previous = checkIntervalHours;
    setCheckIntervalHours(next);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        updates: { autoCheck, autoDownload, checkIntervalHours: next },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      // Update from server response
      if (result.settings?.updates) {
        setAutoCheck(result.settings.updates.autoCheck ?? autoCheck);
        setAutoDownload(result.settings.updates.autoDownload ?? autoDownload);
        setCheckIntervalHours(result.settings.updates.checkIntervalHours ?? next);
      }
    } catch (error) {
      console.error('Failed to update check interval setting:', error);
      setCheckIntervalHours(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Control how Emdash checks for and downloads updates. Updates are installed when you quit the
        app.
      </div>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm">Automatically check for updates</span>
          <Switch
            checked={autoCheck}
            disabled={loading || saving}
            onCheckedChange={updateAutoCheck}
          />
        </label>

        <label className="flex items-center justify-between gap-2">
          <span className="text-sm">Automatically download updates</span>
          <Switch
            checked={autoDownload}
            disabled={loading || saving || !autoCheck}
            onCheckedChange={updateAutoDownload}
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Check frequency</span>
          <Select
            value={String(checkIntervalHours)}
            onValueChange={updateCheckInterval}
            disabled={loading || saving || !autoCheck}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Every hour</SelectItem>
              <SelectItem value="12">Twice daily</SelectItem>
              <SelectItem value="24">Daily</SelectItem>
              <SelectItem value="168">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!autoCheck && (
          <p className="text-xs text-muted-foreground">
            Auto-check is disabled. You can still manually check for updates in the Version section
            below.
          </p>
        )}
      </div>
    </div>
  );
};

export default UpdateSettingsCard;
