import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ThemeProvider } from '../primitives/theme-provider';
import { Heading } from '../primitives/typography/Heading';
import { Text } from '../primitives/typography/Text';
import { textVariants, type TextVariantProps } from '../primitives/typography/typography.variants';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Theme/Typography',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

// ── Primitive scale tokens ────────────────────────────────────────────────────

const SIZE_TOKENS = [
  { name: '--text-micro', size: '10px', lh: '1.2' },
  { name: '--text-tiny', size: '11px', lh: '1.3' },
  { name: '--text-xs', size: '12px', lh: '1.5' },
  { name: '--text-sm', size: '13px', lh: '1.5' },
  { name: '--text-base', size: '14px', lh: '1.5' },
  { name: '--text-lg', size: '17px', lh: '1.5' },
  { name: '--text-xl', size: '20px', lh: '1.4' },
  { name: '--text-2xl', size: '24px', lh: '1.3' },
];

const WEIGHT_TOKENS = [
  { name: '--font-weight-normal', value: 400, label: 'Normal 400' },
  { name: '--font-weight-medium', value: 500, label: 'Medium 500' },
  { name: '--font-weight-semibold', value: 600, label: 'Semibold 600' },
  { name: '--font-weight-bold', value: 700, label: 'Bold 700' },
];

/** Primitive type size scale — each --text-* token. */
export const TypeScale: Story = {
  render: () => (
    <div className={`${s.flex} ${s.flexCol} ${s.gap2} ${s.p4}`}>
      <div className={s.mb4}>
        <h2 className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>Type size scale</h2>
        <p className={`${s.mt1} ${s.textXs} ${s.textForegroundMuted}`}>
          Primitive <code className={s.fontMono}>--text-*</code> tokens. Semantic{' '}
          <code className={s.fontMono}>--type-&lt;role&gt;-font-size</code> values reference these.
        </p>
      </div>
      {SIZE_TOKENS.map(({ name, size, lh }) => (
        <div key={name} className={`${s.flex} ${s.itemsBaseline} ${s.gap4}`}>
          <div className={`${s.w48} ${s.shrink0} ${s.textRight}`}>
            <code className={`${s.fontMono} ${s.textXs} ${s.textForegroundPassive}`}>{name}</code>
            <span className={`${s.ml2} ${s.textXs} ${s.textForegroundPassive}`}>
              {size} / {lh}
            </span>
          </div>
          <span
            style={{ fontSize: `var(${name})`, lineHeight: `var(${name}--line-height, ${lh})` }}
            className={s.textForeground}
          >
            The quick brown fox jumps over the lazy dog.
          </span>
        </div>
      ))}
    </div>
  ),
};

/** Font weight scale — each --font-weight-* token. */
export const Weights: Story = {
  render: () => (
    <div className={`${s.flex} ${s.flexCol} ${s.gap4} ${s.p4}`}>
      <div className={s.mb2}>
        <h2 className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>Font weight scale</h2>
        <p className={`${s.mt1} ${s.textXs} ${s.textForegroundMuted}`}>
          Primitive <code className={s.fontMono}>--font-weight-*</code> tokens.
        </p>
      </div>
      {WEIGHT_TOKENS.map(({ name, value, label }) => (
        <div key={name} className={`${s.flex} ${s.itemsBaseline} ${s.gap4}`}>
          <div className={`${s.w48} ${s.shrink0} ${s.textRight}`}>
            <code className={`${s.fontMono} ${s.textXs} ${s.textForegroundPassive}`}>{name}</code>
            <span className={`${s.ml2} ${s.textXs} ${s.textForegroundPassive}`}>{value}</span>
          </div>
          <span
            style={{ fontWeight: `var(${name})`, fontSize: '14px' }}
            className={s.textForeground}
          >
            {label}: The quick brown fox jumps over the lazy dog.
          </span>
        </div>
      ))}
    </div>
  ),
};

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
    <div className={`${s.flex} ${s.flexCol} ${s.gap4}`}>
      {ROLES.map(({ label, variant }) => (
        <div key={variant} className={`${s.flex} ${s.itemsBaseline} ${s.gap4}`}>
          <span
            className={`${s.w52} ${s.shrink0} ${s.fontMono} ${s.textXs} ${s.textForegroundPassive}`}
          >
            {label}
          </span>
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
    <div className={`${s.flex} ${s.flexCol} ${s.gap3}`}>
      <Heading level={1}>Heading level 1 — 20px / 700</Heading>
      <Heading level={2}>Heading level 2 — 17px / 700</Heading>
      <Heading level={3}>Heading level 3 — 14px / 600</Heading>
    </div>
  ),
};

/** Tone variants — default, muted, passive. */
export const Tones: Story = {
  render: () => (
    <div className={`${s.flex} ${s.flexCol} ${s.gap2}`}>
      {(['default', 'muted', 'passive'] as const).map((tone) => (
        <Text key={tone} as="p" variant="body" tone={tone}>
          tone="{tone}": The quick brown fox jumps over the lazy dog.
        </Text>
      ))}
    </div>
  ),
};

/** className extension — role + extra utility classes. */
export const ClassExtension: Story = {
  render: () => (
    <div className={`${s.flex} ${s.flexCol} ${s.gap2}`}>
      <Text as="p" variant="body" className={`${s.italic} ${s.underline}`}>
        className extension: italic + underline applied after role.
      </Text>
      <Heading level={2} className={s.textForegroundMuted}>
        Muted h2 via className
      </Heading>
    </div>
  ),
};

/** textVariants recipe used directly (no component wrapper). */
export const RecipeDirectUse: Story = {
  render: () => (
    <div className={`${s.flex} ${s.flexCol} ${s.gap2}`}>
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
    <div className={`${s.grid} ${s.cols5} ${s.gap3}`}>
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map((sv) => (
        <div key={sv} className={`surface-${sv} bg-surface ${s.roundedLg} ${s.p4}`}>
          <p className={`${s.mb1} ${s.fontMono} ${s.textXs} ${s.textForegroundPassive}`}>
            .surface-{sv}
          </p>
          <Heading level={2} className={s.mb1}>
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
    <div className={`${s.flex} ${s.minHScreen} ${s.divideX} ${s.divideBorder}`}>
      <ThemeProvider defaultTheme="light" className={`${s.flex1} ${s.bgBackground} ${s.p8}`}>
        <Heading level={1} className={s.mb2}>
          Light mode
        </Heading>
        <Text as="p" variant="body" tone="default" className={s.mb1}>
          Body text
        </Text>
        <Text as="p" variant="body" tone="muted">
          Muted body text
        </Text>
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className={`${s.flex1} ${s.bgBackground} ${s.p8}`}>
        <Heading level={1} className={s.mb2}>
          Dark mode
        </Heading>
        <Text as="p" variant="body" tone="default" className={s.mb1}>
          Body text
        </Text>
        <Text as="p" variant="body" tone="muted">
          Muted body text
        </Text>
      </ThemeProvider>
    </div>
  ),
};
