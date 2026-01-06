import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Download,
  CheckCircle,
  AlertCircle,
  Info,
  RefreshCw,
  Clock,
  Zap,
  FileText,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useUpdater } from '@/hooks/useUpdater';

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  lastCheck?: Date;
  nextCheck?: Date;
  currentVersion: string;
  availableVersion?: string;
  downloadProgress?: {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
    remainingTime?: number;
  };
  error?: string;
  releaseNotes?: string;
  channel: 'stable' | 'beta' | 'alpha' | 'nightly';
}

interface UpdateSettings {
  autoCheck: boolean;
  autoDownload: boolean;
  checkInterval: number;
  channel: string;
}

export function EnhancedUpdateCard(): JSX.Element {
  const updater = useUpdater();
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  // Fetch update state on mount
  useEffect(() => {
    fetchUpdateState();
    fetchSettings();

    // Poll for state changes during active operations
    const interval = setInterval(() => {
      if (updateState?.status === 'checking' || updateState?.status === 'downloading') {
        fetchUpdateState();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [updateState?.status]);

  const fetchUpdateState = async () => {
    try {
      const result = await window.electronAPI.getUpdateState?.();
      if (result?.success && result.data) {
        setUpdateState(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch update state:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const result = await window.electronAPI.getUpdateSettings?.();
      if (result?.success && result.data) {
        setSettings(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  };

  const fetchReleaseNotes = async () => {
    if (updateState?.releaseNotes) return;

    setIsLoadingNotes(true);
    try {
      const result = await window.electronAPI.getReleaseNotes?.();
      if (result?.success && result.data) {
        setUpdateState(prev => prev ? { ...prev, releaseNotes: result.data || undefined } : null);
      }
    } catch (error) {
      console.error('Failed to fetch release notes:', error);
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const handleCheckNow = async () => {
    await updater.check();
    await fetchUpdateState();
  };

  const handleDownload = async () => {
    await updater.download();
    await fetchUpdateState();
  };

  const handleInstall = () => {
    updater.install();
  };

  const handleSettingChange = async (key: keyof UpdateSettings, value: any) => {
    if (!settings) return;

    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    try {
      const result = await window.electronAPI.updateUpdateSettings?.(newSettings);
      if (!result?.success) {
        // Revert on failure
        setSettings(settings);
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
      setSettings(settings);
    }
  };

  const formatBytes = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  };

  const formatSpeed = (bytesPerSec: number): string => {
    return `${formatBytes(bytesPerSec)}/s`;
  };

  if (!updateState) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <div className="animate-pulse">Loading update status...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Software Updates</CardTitle>
            <CardDescription className="mt-1">
              Current version: {updateState.currentVersion}
              {updateState.channel !== 'stable' && (
                <Badge variant="outline" className="ml-2">
                  {updateState.channel}
                </Badge>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {updateState.status === 'available' && (
              <Badge variant="default" className="animate-pulse">
                Update Available
              </Badge>
            )}
            {updateState.status === 'downloaded' && (
              <Badge variant="default" className="bg-green-600">
                Ready to Install
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status Section */}
        <div className="space-y-3">
          {updateState.status === 'idle' && (
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm">Your app is up to date</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckNow}
                disabled={false}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Check Now
              </Button>
            </div>
          )}

          {updateState.status === 'checking' && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
              <span className="text-sm">Checking for updates...</span>
            </div>
          )}

          {updateState.status === 'available' && updateState.availableVersion && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm font-medium">
                    Version {updateState.availableVersion} is available
                  </span>
                </div>
                <Button size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>

              <div className="border rounded-lg p-3">
                <button
                  className="flex items-center justify-between w-full text-left"
                  onClick={() => {
                    setShowReleaseNotes(!showReleaseNotes);
                    if (!showReleaseNotes && !updateState.releaseNotes) {
                      fetchReleaseNotes();
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm font-medium">What's New</span>
                  </div>
                  {showReleaseNotes ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {showReleaseNotes && (
                  <div className="mt-3 pt-3 border-t">
                    {isLoadingNotes ? (
                      <div className="animate-pulse text-sm text-gray-500">
                        Loading release notes...
                      </div>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-h-60 overflow-y-auto">
                        {updateState.releaseNotes ? (
                          <pre className="whitespace-pre-wrap text-xs">
                            {updateState.releaseNotes}
                          </pre>
                        ) : (
                          <p className="text-sm text-gray-500">No release notes available</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {updateState.status === 'downloading' && updateState.downloadProgress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Downloading update...</span>
                <span className="text-sm text-gray-500">
                  {Math.round(updateState.downloadProgress.percent)}%
                </span>
              </div>
              <Progress value={updateState.downloadProgress.percent} className="h-2" />
              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  {formatBytes(updateState.downloadProgress.transferred)} / {formatBytes(updateState.downloadProgress.total)}
                </span>
                <span>{formatSpeed(updateState.downloadProgress.bytesPerSecond)}</span>
                {updateState.downloadProgress.remainingTime && (
                  <span>~{formatTime(updateState.downloadProgress.remainingTime)} remaining</span>
                )}
              </div>
            </div>
          )}

          {updateState.status === 'downloaded' && (
            <div className="space-y-3">
              <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-sm">
                  Update downloaded successfully. Restart to apply the update.
                </AlertDescription>
              </Alert>
              <Button onClick={handleInstall} className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                Restart and Install
              </Button>
            </div>
          )}

          {updateState.status === 'error' && updateState.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {updateState.error}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Update Schedule Info */}
        {settings?.autoCheck && updateState.lastCheck && (
          <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
            <span>
              Last checked: {new Date(updateState.lastCheck).toLocaleTimeString()}
            </span>
            {updateState.nextCheck && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Next check: {new Date(updateState.nextCheck).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {settings && (
          <div className="border-t pt-3">
            <button
              className="flex items-center justify-between w-full text-left"
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
            >
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span className="text-sm font-medium">Update Settings</span>
              </div>
              {showAdvancedSettings ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {showAdvancedSettings && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="auto-check" className="text-sm">
                    Check for updates automatically
                  </label>
                  <Switch
                    id="auto-check"
                    checked={settings.autoCheck}
                    onCheckedChange={(checked) => handleSettingChange('autoCheck', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="auto-download" className="text-sm">
                    Download updates automatically
                  </label>
                  <Switch
                    id="auto-download"
                    checked={settings.autoDownload}
                    onCheckedChange={(checked) => handleSettingChange('autoDownload', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="channel" className="text-sm">
                    Update channel
                  </label>
                  <Select
                    value={settings.channel}
                    onValueChange={(value) => handleSettingChange('channel', value)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stable">Stable</SelectItem>
                      <SelectItem value="beta">Beta</SelectItem>
                      <SelectItem value="alpha">Alpha</SelectItem>
                      <SelectItem value="nightly">Nightly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Check interval */}
                <div className="flex items-center justify-between">
                  <label htmlFor="interval" className="text-sm">
                    Check interval
                  </label>
                  <Select
                    value={String(settings.checkInterval)}
                    onValueChange={(value) => handleSettingChange('checkInterval', parseInt(value))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3600000">Every hour</SelectItem>
                      <SelectItem value="14400000">Every 4 hours</SelectItem>
                      <SelectItem value="43200000">Every 12 hours</SelectItem>
                      <SelectItem value="86400000">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-2 border-t">
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Beta and alpha channels may contain unstable features. Use with caution.
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}