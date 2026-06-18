import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Heading } from '../primitives/typography/Heading';
import { Text } from '../primitives/typography/Text';
import { textVariants, type TextVariantProps } from '../primitives/typography/typography.variants';

const meta: Meta = {
  title: 'Theme/Typography',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

// ── All roles ─────────────────────────────────────────────────────────────────

const ROLES: Array<{ label: string; variant: TextVariantProps['variant']; as?: string }> = [
  { label: 'h1 — 20px / 700', variant: 'h1', as: 'p' },
  { label: 'h2 — 17px / 700', variant: 'h2', as: 'p' },
  { label: 'h3 — 14px / 600', variant: 'h3', as: 'p' },
  { label: 'body — 14px / 400', variant: 'body', as: 'p' },
  { label: 'bodyBold — 14px / 700', variant: 'bodyBold', as: 'p' },
  { label: 'bodyItalic — 14px / 400 italic', variant: 'bodyItalic', as: 'p' },
  { label: 'bodyLink — 14px / 500', variant: 'bodyLink', as: 'p' },
  { label: 'inlineCode — 12px / 600 mono', variant: 'inlineCode', as: 'p' },
  { label: 'code — 12px / 400 mono', variant: 'code', as: 'p' },
  { label: 'codeLang — 11px / 500 sans', variant: 'codeLang', as: 'p' },
  { label: 'mention — 12px / 700', variant: 'mention', as: 'p' },
];

/** Every typography role applied to a sample sentence. */
export const AllRoles: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {ROLES.map(({ label, variant }) => (
        <div key={variant} className="flex items-baseline gap-4">
          <span className="w-52 shrink-0 font-mono text-xs text-foreground-passive">{label}</span>
          <Text as="p" variant={variant} tone="default">
            The quick brown fox jumps over the lazy dog.
          </Text>
        </div>
      ))}
    </div>
  ),
};

/** Heading component: levels 1–3. */
export const Headings: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Heading level={1}>Heading level 1 — 20px / 700</Heading>
      <Heading level={2}>Heading level 2 — 17px / 700</Heading>
      <Heading level={3}>Heading level 3 — 14px / 600</Heading>
    </div>
  ),
};

/** Tone variants — default, muted, passive. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(['default', 'muted', 'passive'] as const).map((tone) => (
        <Text key={tone} as="p" variant="body" tone={tone}>
          tone="{tone}": The quick brown fox jumps over the lazy dog.
        </Text>
      ))}
    </div>
  ),
};

/** className extension — role + extra Tailwind classes. */
export const ClassExtension: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Text as="p" variant="body" className="italic underline">
        className extension: italic + underline applied after role.
      </Text>
      <Heading level={2} className="text-foreground-muted">
        Muted h2 via className
      </Heading>
    </div>
  ),
};

/** textVariants recipe used directly (no component wrapper). */
export const RecipeDirectUse: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <p className={textVariants({ variant: 'h1', tone: 'default' })}>
        textVariants — h1 role, default tone
      </p>
      <p className={textVariants({ variant: 'body', tone: 'muted' })}>
        textVariants — body role, muted tone
      </p>
    </div>
  ),
};

/** All surfaces side-by-side to confirm readability. */
export const AllSurfaces: Story = {
  render: () => (
    <div className="grid grid-cols-5 gap-3">
      {(['sunken', 'base', 'raised', 'overlay', 'floating'] as const).map((s) => (
        <div key={s} className={`surface-${s} rounded-lg bg-surface p-4`}>
          <p className="mb-1 font-mono text-xs text-foreground-passive">.surface-{s}</p>
          <Heading level={2} className="mb-1">
            Heading
          </Heading>
          <Text as="p" variant="body" tone="default">
            Body text on this surface.
          </Text>
          <Text as="p" variant="body" tone="muted">
            Muted body text.
          </Text>
        </div>
      ))}
    </div>
  ),
};

/** Light and dark modes side-by-side. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen divide-x divide-border">
      <div className="emlight flex-1 bg-background p-8">
        <Heading level={1} className="mb-2">
          Light mode
        </Heading>
        <Text as="p" variant="body" tone="default" className="mb-1">
          Body text
        </Text>
        <Text as="p" variant="body" tone="muted">
          Muted body text
        </Text>
      </div>
      <div className="emdark flex-1 bg-background p-8">
        <Heading level={1} className="mb-2">
          Dark mode
        </Heading>
        <Text as="p" variant="body" tone="default" className="mb-1">
          Body text
        </Text>
        <Text as="p" variant="body" tone="muted">
          Muted body text
        </Text>
      </div>
    </div>
  ),
};
