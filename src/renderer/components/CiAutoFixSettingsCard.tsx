import React, { useMemo } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { isValidProviderId, PROVIDERS, type ProviderId } from '@shared/providers/registry';

const DEFAULT_INCLUDE_FILTERS = '*test*, *lint*';
const DEFAULT_EXCLUDE_FILTERS = '*deploy*, *build*';

function parseFilterList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const CiAutoFixSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();
  const ciAutoFix = settings?.ciAutoFix;

  const includeFiltersValue =
    ciAutoFix?.triggerFilters?.include?.join(', ') || DEFAULT_INCLUDE_FILTERS;
  const excludeFiltersValue =
    ciAutoFix?.triggerFilters?.exclude?.join(', ') || DEFAULT_EXCLUDE_FILTERS;

  const selectedProvider = ciAutoFix?.providerId || 'auto';

  const toProviderOverride = (providerId: string): ProviderId | undefined => {
    if (providerId === 'auto') return undefined;
    if (isValidProviderId(providerId)) {
      return providerId;
    }
    return undefined;
  };

  const providerOptions = useMemo(
    () => [
      { id: 'auto', name: 'Task/default provider' },
      ...PROVIDERS.map((provider) => ({ id: provider.id, name: provider.name })),
    ],
    []
  );

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-muted p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">CI auto-fix</p>
          <p className="text-sm text-muted-foreground">
            Automatically run an agent when GitHub Actions fails on active task branches.
          </p>
        </div>
        <Switch
          checked={ciAutoFix?.enabled ?? false}
          disabled={isLoading || isSaving}
          onCheckedChange={(enabled) => updateSettings({ ciAutoFix: { enabled } })}
          aria-label="Enable CI auto-fix"
        />
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Mode</p>
            <p className="text-sm text-muted-foreground">
              Auto commits and pushes; review leaves changes for manual approval.
            </p>
          </div>
          <Select
            value={ciAutoFix?.mode ?? 'review'}
            onValueChange={(mode) =>
              updateSettings({ ciAutoFix: { mode: mode as 'auto' | 'review' } })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="review">review</SelectItem>
              <SelectItem value="auto">auto</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Provider</p>
            <p className="text-sm text-muted-foreground">
              Override the agent provider used for CI fixes.
            </p>
          </div>
          <Select
            value={selectedProvider}
            onValueChange={(providerId) =>
              updateSettings({
                ciAutoFix: {
                  providerId: toProviderOverride(providerId),
                },
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Max retries</p>
            <p className="text-sm text-muted-foreground">
              Stops re-triggering after this many auto-fix attempts per branch.
            </p>
          </div>
          <Input
            type="number"
            min={0}
            max={20}
            value={ciAutoFix?.maxRetries ?? 2}
            disabled={isLoading || isSaving}
            onChange={(event) => {
              const value = Number(event.target.value);
              updateSettings({ ciAutoFix: { maxRetries: Number.isFinite(value) ? value : 2 } });
            }}
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Max log chars</p>
            <p className="text-sm text-muted-foreground">Tail length passed to the agent prompt.</p>
          </div>
          <Input
            type="number"
            min={500}
            max={40000}
            step={100}
            value={ciAutoFix?.maxLogChars ?? 4000}
            disabled={isLoading || isSaving}
            onChange={(event) => {
              const value = Number(event.target.value);
              updateSettings({ ciAutoFix: { maxLogChars: Number.isFinite(value) ? value : 4000 } });
            }}
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Poll interval (ms)</p>
            <p className="text-sm text-muted-foreground">How often CI checks are polled.</p>
          </div>
          <Input
            type="number"
            min={15000}
            max={1800000}
            step={1000}
            value={ciAutoFix?.pollIntervalMs ?? 120000}
            disabled={isLoading || isSaving}
            onChange={(event) => {
              const value = Number(event.target.value);
              updateSettings({
                ciAutoFix: { pollIntervalMs: Number.isFinite(value) ? value : 120000 },
              });
            }}
          />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">Trigger filters (include)</p>
          <Input
            key={`include-${includeFiltersValue}`}
            defaultValue={includeFiltersValue}
            disabled={isLoading || isSaving}
            onBlur={(event) =>
              updateSettings({
                ciAutoFix: { triggerFilters: { include: parseFilterList(event.target.value) } },
              })
            }
            placeholder="*test*, *lint*, /regex/"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated glob or /regex/ patterns. Only matching checks trigger auto-fix.
          </p>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">Trigger filters (exclude)</p>
          <Input
            key={`exclude-${excludeFiltersValue}`}
            defaultValue={excludeFiltersValue}
            disabled={isLoading || isSaving}
            onBlur={(event) =>
              updateSettings({
                ciAutoFix: { triggerFilters: { exclude: parseFilterList(event.target.value) } },
              })
            }
            placeholder="*deploy*, *build*, /regex/"
          />
          <p className="text-xs text-muted-foreground">
            Excluded patterns always win over include patterns.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CiAutoFixSettingsCard;
