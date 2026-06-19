/**
 * ComboboxPopover — searchable combobox-in-popover component
 *
 * Stories demonstrate:
 *  - Basic flat list with in-popover search
 *  - With per-row detail hover card
 *  - Interaction inside detail card keeps popover open
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, Cpu, Zap } from 'lucide-react';
import React, { useState } from 'react';
import { ComboboxPopover } from './combobox-popover';

// ── Shared data ───────────────────────────────────────────────────────────────

interface ModelItem {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextK: number;
  speed: number;
  intelligence: number;
}

const MODELS: ModelItem[] = [
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
    description: 'Most capable model for complex reasoning and nuanced tasks.',
    contextK: 200,
    speed: 0.4,
    intelligence: 1.0,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    description: 'Excellent balance of speed and intelligence.',
    contextK: 200,
    speed: 0.75,
    intelligence: 0.85,
  },
  {
    id: 'claude-haiku-4',
    name: 'Claude Haiku 4',
    provider: 'Anthropic',
    description: 'Fast and efficient for high-volume tasks.',
    contextK: 200,
    speed: 0.95,
    intelligence: 0.65,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    description: 'OpenAI flagship multimodal model.',
    contextK: 128,
    speed: 0.7,
    intelligence: 0.9,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    description: 'Lightweight, cost-efficient GPT-4o variant.',
    contextK: 128,
    speed: 0.9,
    intelligence: 0.7,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    description: "Google's most capable model — 1M context window.",
    contextK: 1000,
    speed: 0.6,
    intelligence: 0.95,
  },
];

function BarMeter({ value }: { value: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 5);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="size-1.5 rounded-full"
          style={{ background: i < filled ? 'var(--foreground-muted)' : 'var(--border)' }}
        />
      ))}
    </span>
  );
}

function ModelDetailCard({ item }: { item: ModelItem }) {
  return (
    <div className="w-52 p-3 text-sm" style={{ color: 'var(--foreground)' }}>
      <div className="flex items-center gap-1.5">
        <Bot className="size-4 shrink-0" style={{ color: 'var(--foreground-muted)' }} />
        <p className="font-medium leading-tight">{item.name}</p>
      </div>
      <p
        className="mt-1.5 text-xs leading-snug"
        style={{ color: 'var(--foreground-muted)' }}
      >
        {item.description}
      </p>
      <div
        className="mt-2 space-y-1.5 border-t pt-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--foreground-muted)' }}>Context</span>
          <span style={{ color: 'var(--foreground)' }}>{item.contextK}K</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1" style={{ color: 'var(--foreground-muted)' }}>
            <Zap className="size-3" /> Speed
          </span>
          <BarMeter value={item.speed} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1" style={{ color: 'var(--foreground-muted)' }}>
            <Cpu className="size-3" /> Intelligence
          </span>
          <BarMeter value={item.intelligence} />
        </div>
      </div>
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Components/ComboboxPopover',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

// ── Stories ───────────────────────────────────────────────────────────────────

function BasicStory() {
  const [value, setValue] = useState<string>('claude-sonnet-4-5');
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
        Selected: <strong>{MODELS.find((m) => m.id === value)?.name ?? '—'}</strong>
      </p>
      <ComboboxPopover<ModelItem>
        items={MODELS}
        value={value}
        onValueChange={setValue}
        itemToKey={(m) => m.id}
        itemToLabel={(m) => m.name}
        searchPlaceholder="Search models…"
        renderTrigger={(selected) => (
          <span className="text-xs">{selected?.name ?? 'Pick a model'}</span>
        )}
        renderItem={(item) => <span className="flex-1 truncate text-sm">{item.name}</span>}
      />
    </div>
  );
}

function WithDetailHoverCardStory() {
  const [value, setValue] = useState<string>('claude-sonnet-4-5');
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
        Hover any row in the list to see the detail card.
      </p>
      <ComboboxPopover<ModelItem>
        items={MODELS}
        value={value}
        onValueChange={setValue}
        itemToKey={(m) => m.id}
        itemToLabel={(m) => m.name}
        searchPlaceholder="Search models…"
        renderTrigger={(selected) => (
          <span className="text-xs">{selected?.name ?? 'Pick a model'}</span>
        )}
        renderItem={(item) => <span className="flex-1 truncate text-sm">{item.name}</span>}
        renderItemDetail={(item) => <ModelDetailCard item={item} />}
        detailSide="right"
        detailAlign="start"
      />
    </div>
  );
}

function DetailCardAboveStory() {
  const [value, setValue] = useState<string>('gpt-4o');
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
        Hover a row — detail card appears above the popover (for bottom-anchored selectors like
        the composer toolbar).
      </p>
      <ComboboxPopover<ModelItem>
        items={MODELS}
        value={value}
        onValueChange={setValue}
        itemToKey={(m) => m.id}
        itemToLabel={(m) => m.name}
        searchPlaceholder="Search models…"
        renderTrigger={(selected) => (
          <span className="text-xs">{selected?.name ?? 'Pick a model'}</span>
        )}
        renderItem={(item) => (
          <div className="flex items-center gap-2">
            <Bot className="size-3.5 shrink-0" style={{ color: 'var(--foreground-muted)' }} />
            <span className="flex-1 truncate text-sm">{item.name}</span>
            <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              {item.provider}
            </span>
          </div>
        )}
        renderItemDetail={(item) => <ModelDetailCard item={item} />}
        detailSide="top"
        detailAlign="start"
      />
    </div>
  );
}

export const Basic: Story = {
  name: 'Basic',
  render: () => <BasicStory />,
};

export const WithDetailHoverCard: Story = {
  name: 'With detail hover card',
  render: () => <WithDetailHoverCardStory />,
};

export const DetailCardAbove: Story = {
  name: 'Detail card above (detailSide=top)',
  render: () => <DetailCardAboveStory />,
};
