import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export interface ModelOption {
  id: string;
  name: string;
  supportsFast: boolean;
}

interface Props {
  value: string;
  onChange: (model: string) => void;
  onModelsLoaded?: (models: ModelOption[]) => void;
}

/** Internal sentinel representing "use provider default" (no --model flag). */
const DEFAULT_MODEL_SENTINEL = '__model_default__';

export function ClaudeModelSelect({ value, onChange, onModelsLoaded }: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const promise = window.electronAPI.listProviderModels?.('claude');
    if (!promise) return;
    promise
      .then((result) => {
        if (cancelled) return;
        if (result?.success && Array.isArray(result.models) && result.models.length > 0) {
          // Normalise: older cached responses may lack supportsFast — fall back to opus check
          const normalised: ModelOption[] = result.models.map((m) => ({
            ...m,
            supportsFast: m.supportsFast ?? m.id.toLowerCase().includes('opus'),
          }));
          setModels(normalised);
          onModelsLoaded?.(normalised);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const selectValue = value || DEFAULT_MODEL_SENTINEL;
  const handleChange = (v: string) => onChange(v === DEFAULT_MODEL_SENTINEL ? '' : v);

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <SelectTrigger className="h-8 flex-1 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL_SENTINEL} className="text-xs">
          Default
        </SelectItem>
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
