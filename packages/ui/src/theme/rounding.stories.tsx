import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

const meta: Meta = {
  title: 'Theme/Rounding',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

const RADIUS_TOKENS: Array<{ name: string; var: string; label: string }> = [
  { name: 'xs', var: '--radius-xs', label: '0.25rem / 4px' },
  { name: 'sm', var: '--radius-sm', label: '0.375rem / 6px' },
  { name: 'md', var: '--radius-md', label: '0.5rem / 8px' },
  { name: 'lg', var: '--radius-lg', label: '0.625rem / 10px' },
  { name: 'xl', var: '--radius-xl', label: '0.875rem / 14px' },
  { name: '2xl', var: '--radius-2xl', label: '1.25rem / 20px' },
  { name: 'full', var: '--radius-full', label: '9999px' },
];

/** All radius tokens with swatches showing the curvature. */
export const Scale: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Radius scale</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Each swatch uses <code className="font-mono">border-radius: var(--radius-*)</code>. The
          anchor is <code className="font-mono">--radius: 0.5rem</code>; change it to rescale the
          whole system.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-6 lg:grid-cols-7">
        {RADIUS_TOKENS.map(({ name, var: cssVar, label }) => (
          <div key={name} className="flex flex-col items-center gap-3">
            <div
              className="h-16 w-16 border-2 border-border bg-surface-emphasis"
              style={{ borderRadius: `var(${cssVar})` }}
            />
            <div className="text-center">
              <p className="font-mono text-xs font-medium text-foreground">{cssVar}</p>
              <p className="mt-0.5 font-mono text-[10px] text-foreground-passive">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

/** Controls and inputs use the token scale. */
export const InContext: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Tokens in use</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Buttons use <code className="font-mono">rounded-lg</code> (base) and{' '}
          <code className="font-mono">rounded-md</code> (sm). Inputs use{' '}
          <code className="font-mono">rounded-md</code>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* Import lazily so this story doesn't add a hard dep on Button */}
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-surface-hover px-2.5 text-sm text-foreground"
        >
          Base button (rounded-lg)
        </button>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-md border border-transparent bg-surface-hover px-2 text-xs text-foreground"
        >
          SM button (rounded-md)
        </button>
        <input
          type="text"
          placeholder="Input (rounded-md)"
          className="h-8 rounded-md border border-border bg-surface-input px-2.5 text-sm text-foreground outline-none"
        />
      </div>
    </div>
  ),
};
