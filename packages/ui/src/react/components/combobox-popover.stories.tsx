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
import * as s from '../story-layout.css';

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
    <span className={`${s.flex} ${s.itemsCenter} ${s.gapHalf}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`${s.size15} ${s.roundedFull}`}
          style={{ background: i < filled ? 'var(--foreground-muted)' : 'var(--border)' }}
        />
      ))}
    </span>
  );
}

function ModelDetailCard({ item }: { item: ModelItem }) {
  return (
    <div className={`${s.w52} ${s.p3} ${s.textSm}`} style={{ color: 'var(--foreground)' }}>
      <div className={`${s.flex} ${s.itemsCenter} ${s.gap15}`}>
        <Bot className={`${s.size4} ${s.shrink0}`} style={{ color: 'var(--foreground-muted)' }} />
        <p className={`${s.leadingTight} ${s.fontMedium}`}>{item.name}</p>
      </div>
      <p
        className={`${s.mt15} ${s.textXs} ${s.leadingSnug}`}
        style={{ color: 'var(--foreground-muted)' }}
      >
        {item.description}
      </p>
      <div
        className={`${s.mt2} ${s.spaceY15} ${s.borderT} ${s.pt2}`}
        style={{ borderColor: 'var(--border)' }}
      >
        <div className={`${s.flex} ${s.itemsCenter} ${s.justifyBetween} ${s.textXs}`}>
          <span style={{ color: 'var(--foreground-muted)' }}>Context</span>
          <span style={{ color: 'var(--foreground)' }}>{item.contextK}K</span>
        </div>
        <div className={`${s.flex} ${s.itemsCenter} ${s.justifyBetween} ${s.textXs}`}>
          <span
            className={`${s.flex} ${s.itemsCenter} ${s.gap1}`}
            style={{ color: 'var(--foreground-muted)' }}
          >
            <Zap className={s.size3} /> Speed
          </span>
          <BarMeter value={item.speed} />
        </div>
        <div className={`${s.flex} ${s.itemsCenter} ${s.justifyBetween} ${s.textXs}`}>
          <span
            className={`${s.flex} ${s.itemsCenter} ${s.gap1}`}
            style={{ color: 'var(--foreground-muted)' }}
          >
            <Cpu className={s.size3} /> Intelligence
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
    <div className={`${s.flex} ${s.flexCol} ${s.itemsCenter} ${s.gap4}`}>
      <p className={s.textXs} style={{ color: 'var(--foreground-muted)' }}>
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
          <span className={s.textXs}>{selected?.name ?? 'Pick a model'}</span>
        )}
        renderItem={(item) => (
          <span className={`${s.flex1} ${s.truncate} ${s.textSm}`}>{item.name}</span>
        )}
      />
    </div>
  );
}

function WithDetailHoverCardStory() {
  const [value, setValue] = useState<string>('claude-sonnet-4-5');
  return (
    <div className={`${s.flex} ${s.flexCol} ${s.itemsCenter} ${s.gap4}`}>
      <p className={s.textXs} style={{ color: 'var(--foreground-muted)' }}>
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
          <span className={s.textXs}>{selected?.name ?? 'Pick a model'}</span>
        )}
        renderItem={(item) => (
          <span className={`${s.flex1} ${s.truncate} ${s.textSm}`}>{item.name}</span>
        )}
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
    <div className={`${s.flex} ${s.flexCol} ${s.itemsCenter} ${s.gap4}`}>
      <p className={s.textXs} style={{ color: 'var(--foreground-muted)' }}>
        Hover a row — detail card appears above the popover (for bottom-anchored selectors like the
        composer toolbar).
      </p>
      <ComboboxPopover<ModelItem>
        items={MODELS}
        value={value}
        onValueChange={setValue}
        itemToKey={(m) => m.id}
        itemToLabel={(m) => m.name}
        searchPlaceholder="Search models…"
        renderTrigger={(selected) => (
          <span className={s.textXs}>{selected?.name ?? 'Pick a model'}</span>
        )}
        renderItem={(item) => (
          <div className={`${s.flex} ${s.itemsCenter} ${s.gap2}`}>
            <Bot
              className={`${s.size35} ${s.shrink0}`}
              style={{ color: 'var(--foreground-muted)' }}
            />
            <span className={`${s.flex1} ${s.truncate} ${s.textSm}`}>{item.name}</span>
            <span className={s.textXs} style={{ color: 'var(--foreground-muted)' }}>
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
