import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { ClaudeModelSelect, type ModelOption } from './ClaudeModelSelect';

const EFFORT_SENTINEL = '__effort_default__';

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
] as const;

interface Props {
  model: string;
  onModelChange: (model: string) => void;
  effort: string;
  onEffortChange: (effort: string) => void;
  fastMode: boolean;
  onFastModeChange: (fastMode: boolean) => void;
}

export function ClaudeOptionsSection({
  model,
  onModelChange,
  effort,
  onEffortChange,
  fastMode,
  onFastModeChange,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadedModels, setLoadedModels] = useState<ModelOption[]>([]);

  // Fast mode is only shown when a specific model is selected and that model
  // supports it (currently Opus only). When "Default" is selected we don't know
  // which model will run, so we hide it to avoid silently ignoring the flag.
  const selectedModelMeta = loadedModels.find((m) => m.id === model);
  const showFastMode = !!selectedModelMeta?.supportsFast;

  const effortSelectValue = effort || EFFORT_SENTINEL;
  const handleEffortChange = (v: string) => onEffortChange(v === EFFORT_SENTINEL ? '' : v);

  return (
    <Accordion
      type="single"
      collapsible
      value={isOpen ? 'claude' : undefined}
      className="space-y-2"
    >
      <AccordionItem value="claude" className="border-none">
        <AccordionTrigger
          className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border-none bg-muted px-3 text-sm font-medium text-foreground hover:bg-accent hover:no-underline [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0"
          onPointerDown={(e) => {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen((prev) => !prev);
            }
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span>Claude options</span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="overflow-hidden px-0 pt-2">
          <div className="flex flex-col gap-3 p-2">
            <div className="flex items-center gap-4">
              <Label className="w-16 shrink-0 text-sm">Model</Label>
              <ClaudeModelSelect
                value={model}
                onChange={(m) => {
                  onModelChange(m);
                  // Clear fast mode if the newly selected model doesn't support it
                  const meta = loadedModels.find((lm) => lm.id === m);
                  if (meta && !meta.supportsFast) onFastModeChange(false);
                }}
                onModelsLoaded={setLoadedModels}
              />
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-16 shrink-0 text-sm">Effort</Label>
              <Select value={effortSelectValue} onValueChange={handleEffortChange}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EFFORT_SENTINEL} className="text-xs">
                    Default
                  </SelectItem>
                  {EFFORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showFastMode && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  id="claude-fast-mode"
                  checked={fastMode}
                  onCheckedChange={(v) => onFastModeChange(!!v)}
                />
                <span className="text-muted-foreground">Fast mode</span>
              </label>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
