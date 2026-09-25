import {
  providerChoices,
  type ProviderConfigOption,
  type ProviderOptionValues,
} from '@emdash/core/runtimes/acp/api/client';
import type { ChatComposer } from '@emdash/ui/react/components';
import { Button, Select, Tooltip } from '@emdash/ui/react/primitives';
import { Zap } from 'lucide-react';
import type { ComponentProps } from 'react';

type ComposerProps = ComponentProps<typeof ChatComposer>;

/** Prefer the observed model variant; otherwise keep the latest catalog until live discovery. */
export function selectCachedProviderOptions(
  catalogs: ProviderConfigOption[][],
  values: ProviderOptionValues
): ProviderConfigOption[] {
  const latest = catalogs[0] ?? [];
  const model = latest.find((option) => option.category === 'model');
  if (!model || values[model.id] === undefined) return latest;
  return (
    catalogs.find((options) =>
      options.some((option) => option.id === model.id && option.currentValue === values[model.id])
    ) ?? latest
  );
}

/** Shared by task creation and active chat; all callbacks carry actual provider config ids. */
export function providerComposerOptions(
  options: ProviderConfigOption[],
  values: ProviderOptionValues,
  onChange: (configId: string, value: string | boolean) => void,
  enabled = true,
  live = false
): Partial<ComposerProps> {
  const used = new Set<string>();
  const select = (category: string) => {
    const option = options.find((item) => item.category === category && item.type === 'select');
    if (!option || option.type !== 'select') return null;
    used.add(option.id);
    return {
      choices: Object.fromEntries(
        providerChoices(option).map((choice) => [
          choice.value,
          { name: choice.name, description: choice.description ?? undefined },
        ])
      ),
      selected:
        typeof values[option.id] === 'string'
          ? (values[option.id] as string)
          : live
            ? option.currentValue
            : undefined,
      change: enabled ? (value: string) => onChange(option.id, value) : undefined,
    };
  };
  const model = select('model');
  const effort = model ? select('thought_level') : null;
  const mode = select('mode');
  const collaboration = select('collaboration_mode');
  const additional = options.filter((option) => !used.has(option.id));
  return {
    modelOptions: model?.choices,
    selectedModel: model?.selected,
    onModelChange: model?.change,
    effortOptions: effort?.choices,
    selectedEffort: effort?.selected,
    onEffortChange: effort?.change,
    permissionModeOptions: mode?.choices,
    selectedPermissionMode: mode?.selected,
    onPermissionModeChange: mode?.change,
    collaborationModeOptions: collaboration?.choices,
    selectedCollaborationMode: collaboration?.selected,
    onCollaborationModeChange: collaboration?.change,
    configurationControls: additional.map((option) => {
      const value = live ? option.currentValue : values[option.id];
      const selected = value === undefined ? undefined : String(value);
      const fast = option.id === 'fast' || option.id === 'fast-mode';
      const choices = providerChoices(option);
      if (
        option.type === 'boolean' ||
        (fast &&
          choices.length === 2 &&
          choices.every((choice) => choice.value === 'on' || choice.value === 'off'))
      ) {
        const checked = value === undefined ? undefined : value === true || value === 'on';
        return (
          <Tooltip.Root key={option.id}>
            <Tooltip.Trigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  icon={fast}
                  disabled={!enabled}
                  aria-label={option.name}
                  role={fast ? 'switch' : undefined}
                  aria-checked={fast ? checked === true : undefined}
                  aria-pressed={fast ? undefined : (checked ?? 'mixed')}
                  onClick={() =>
                    onChange(
                      option.id,
                      option.type === 'boolean' ? !checked : checked ? 'off' : 'on'
                    )
                  }
                />
              }
            >
              {fast && <Zap className="h-3.5 w-3.5" fill={checked ? 'currentColor' : 'none'} />}
              {!fast &&
                (checked === undefined ? option.name : `${option.name}: ${checked ? 'On' : 'Off'}`)}
            </Tooltip.Trigger>
            <Tooltip.Content>
              {option.name}
              {checked === undefined ? '' : checked ? ': On' : ': Off'}
              {option.description && <div>{option.description}</div>}
            </Tooltip.Content>
          </Tooltip.Root>
        );
      }
      return (
        <Select.Root
          key={option.id}
          disabled={!enabled}
          value={selected ?? null}
          onValueChange={(value) => {
            if (value !== null) onChange(option.id, value);
          }}
        >
          <Select.Trigger aria-label={option.name} className="h-7 w-auto text-xs">
            <Select.Value>
              {option.name}
              {selected === undefined
                ? ''
                : `: ${choices.find((choice) => choice.value === selected)?.name ?? selected}`}
            </Select.Value>
          </Select.Trigger>
          <Select.Content>
            {choices.map((choice) => (
              <Select.Item key={choice.value} value={choice.value}>
                {choice.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      );
    }),
  };
}
