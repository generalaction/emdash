import React, { useState, useEffect } from 'react';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Spinner } from './ui/spinner';

interface CiAutoFixCheckFilters {
  include?: string[];
  exclude?: string[];
}

interface CiAutoFixSettings {
  enabled: boolean;
  mode: 'auto' | 'review';
  maxRetries: number;
  checkFilters?: CiAutoFixCheckFilters;
}

const DEFAULT_CI_AUTO_FIX: CiAutoFixSettings = {
  enabled: false,
  mode: 'review',
  maxRetries: 3,
};

export default function CiAutoFixSettingsCard() {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();
  const [ciAutoFix, setCiAutoFix] = useState<CiAutoFixSettings>(DEFAULT_CI_AUTO_FIX);
  const [includeInput, setIncludeInput] = useState('');
  const [excludeInput, setExcludeInput] = useState('');

  useEffect(() => {
    if (settings?.ciAutoFix) {
      setCiAutoFix(settings.ciAutoFix);
      setIncludeInput(settings.ciAutoFix.checkFilters?.include?.join(', ') ?? '');
      setExcludeInput(settings.ciAutoFix.checkFilters?.exclude?.join(', ') ?? '');
    }
  }, [settings?.ciAutoFix]);

  const handleUpdate = (updates: Partial<CiAutoFixSettings>) => {
    const next = { ...ciAutoFix, ...updates };
    setCiAutoFix(next);
    updateSettings({ ciAutoFix: next });
  };

  const handleIncludeChange = (value: string) => {
    setIncludeInput(value);
    const include = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    handleUpdate({
      checkFilters: {
        ...ciAutoFix.checkFilters,
        include: include.length > 0 ? include : undefined,
      },
    });
  };

  const handleExcludeChange = (value: string) => {
    setExcludeInput(value);
    const exclude = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    handleUpdate({
      checkFilters: {
        ...ciAutoFix.checkFilters,
        exclude: exclude.length > 0 ? exclude : undefined,
      },
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Spinner size="sm" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">CI Auto-Fix</CardTitle>
        <CardDescription>Automatically trigger agents on CI failure</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="ciAutoFixEnabled">Enable auto-fix</Label>
            <p className="text-xs text-muted-foreground">
              Monitor CI checks and trigger fixes automatically
            </p>
          </div>
          <Switch
            id="ciAutoFixEnabled"
            checked={ciAutoFix.enabled}
            onCheckedChange={(checked) => handleUpdate({ enabled: checked })}
            disabled={isSaving}
          />
        </div>

        {ciAutoFix.enabled && (
          <>
            <div className="space-y-2">
              <Label htmlFor="ciAutoFixMode">Mode</Label>
              <Select
                value={ciAutoFix.mode}
                onValueChange={(value: 'auto' | 'review') => handleUpdate({ mode: value })}
                disabled={isSaving}
              >
                <SelectTrigger id="ciAutoFixMode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Review (propose changes)</SelectItem>
                  <SelectItem value="auto">Auto (auto-commit)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ciAutoFix.mode === 'review'
                  ? 'Changes will be staged for your review'
                  : 'Agent will automatically commit changes'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ciMaxRetries">Max retries</Label>
              <Input
                id="ciMaxRetries"
                type="number"
                min={1}
                max={10}
                value={ciAutoFix.maxRetries}
                onChange={(e) => handleUpdate({ maxRetries: parseInt(e.target.value) || 3 })}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                Maximum retries before giving up on a branch
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ciIncludeChecks">Include checks</Label>
              <Input
                id="ciIncludeChecks"
                placeholder="test, lint, build"
                value={includeInput}
                onChange={(e) => handleIncludeChange(e.target.value)}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                Only trigger on these checks (comma-separated). Leave empty for all.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ciExcludeChecks">Exclude checks</Label>
              <Input
                id="ciExcludeChecks"
                placeholder="deploy, e2e"
                value={excludeInput}
                onChange={(e) => handleExcludeChange(e.target.value)}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                Never trigger on these checks (comma-separated)
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
