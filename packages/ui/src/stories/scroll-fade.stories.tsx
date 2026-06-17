import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ScrollFade } from '../primitives/scroll-fade';

const meta: Meta<typeof ScrollFade> = {
  title: 'Theme/ScrollFade',
  component: ScrollFade,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof ScrollFade>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function Paragraph({ n = 1 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <p key={i} className="text-sm text-foreground">
          Paragraph {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
          tempor incididunt ut labore et dolore magna aliqua.
        </p>
      ))}
    </>
  );
}

function HorizontalItems({ n = 20 }: { n?: number }) {
  return (
    <div className="flex gap-3 whitespace-nowrap">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="bg-surface-raised rounded border border-border px-3 py-1 text-sm">
          Item {i + 1}
        </div>
      ))}
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

/** Vertical fade — content overflows, fades appear top and bottom as you scroll. */
export const VerticalOverflow: Story = {
  render: () => (
    <ScrollFade className="bg-surface h-48 w-80 rounded border border-border">
      <div className="flex flex-col gap-3 p-4">
        <Paragraph n={8} />
      </div>
    </ScrollFade>
  ),
};

/** No overflow — fades should not appear when content fits. */
export const VerticalNoOverflow: Story = {
  render: () => (
    <ScrollFade className="bg-surface h-48 w-80 rounded border border-border">
      <div className="flex flex-col gap-3 p-4">
        <Paragraph n={2} />
      </div>
    </ScrollFade>
  ),
};

/** Horizontal fade — wide content overflows horizontally. */
export const HorizontalOverflow: Story = {
  render: () => (
    <ScrollFade axis="x" className="bg-surface w-80 rounded border border-border">
      <div className="p-4">
        <HorizontalItems n={20} />
      </div>
    </ScrollFade>
  ),
};

/** Both axes — content overflows in both directions. */
export const BothAxes: Story = {
  render: () => (
    <ScrollFade axis="both" className="bg-surface h-48 w-80 rounded border border-border">
      <div className="p-4">
        <div className="mb-3">
          <HorizontalItems n={20} />
        </div>
        <Paragraph n={8} />
      </div>
    </ScrollFade>
  ),
};

/** Non-surface background — override --fade-color to match the container's paint. */
export const NonSurfaceBackground: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-foreground-muted">
        Code-block-style container: overrides <code>--fade-color</code> to match its background.
      </p>
      <ScrollFade
        className="h-40 w-80 rounded border border-border"
        fadeColor="var(--neutral-1)"
        style={{ background: 'var(--neutral-1)' }}
      >
        <pre className="p-4 font-mono text-xs text-foreground">
          {Array.from(
            { length: 20 },
            (_, i) => `const line${i + 1} = "some code value here";`
          ).join('\n')}
        </pre>
      </ScrollFade>
    </div>
  ),
};

/** Custom fade size — larger gradient for a more dramatic effect. */
export const CustomSize: Story = {
  render: () => (
    <div className="flex gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-foreground-muted">size=12 (subtle)</p>
        <ScrollFade size={12} className="bg-surface h-48 w-52 rounded border border-border">
          <div className="flex flex-col gap-3 p-4">
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-foreground-muted">size=48 (dramatic)</p>
        <ScrollFade size={48} className="bg-surface h-48 w-52 rounded border border-border">
          <div className="flex flex-col gap-3 p-4">
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
    </div>
  ),
};

/** All surface elevations side-by-side — verifies automatic surface-cascade color matching. */
export const AllSurfaces: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(['sunken', 'base', 'raised', 'overlay', 'floating'] as const).map((s) => (
        <div key={s} className={`surface-${s} rounded-lg p-4`}>
          <p className="mb-2 text-xs text-foreground-muted">.surface-{s}</p>
          <ScrollFade className="bg-surface h-40 w-44 rounded border border-border">
            <div className="flex flex-col gap-3 p-3">
              <Paragraph n={8} />
            </div>
          </ScrollFade>
        </div>
      ))}
    </div>
  ),
};

/** Light and dark side-by-side — fade color adapts to mode via the surface cascade. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen divide-x divide-border">
      <div className="emlight flex-1 bg-background p-8">
        <p className="mb-4 text-sm font-medium text-foreground">Light mode</p>
        <ScrollFade className="bg-surface h-48 w-80 rounded border border-border">
          <div className="flex flex-col gap-3 p-4">
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
      <div className="emdark flex-1 bg-background p-8">
        <p className="mb-4 text-sm font-medium text-foreground">Dark mode</p>
        <ScrollFade className="bg-surface h-48 w-80 rounded border border-border">
          <div className="flex flex-col gap-3 p-4">
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
    </div>
  ),
};
