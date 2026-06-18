import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect, useRef, useState } from 'react';
import { SCALE_NAMES, STEPS } from '../theme/contract/roles';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScaleName = (typeof SCALE_NAMES)[number];

// ── Swatch components ─────────────────────────────────────────────────────────

function StepSwatch({ scale, step }: { scale: ScaleName; step: number }) {
  const varName = `--${scale}-${step}`;
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState('');

  // Intentionally omit deps: re-read on every render so the value updates
  // when the toolbar switches theme (no infinite loop — setState is skipped when
  // the string is the same reference).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ref.current) {
      const val = getComputedStyle(ref.current).backgroundColor;
      if (val !== resolved) setResolved(val);
    }
  });

  const isStep9 = step === 9;

  return (
    <div className="flex flex-col items-center gap-1" title={`${varName}\n${resolved}`}>
      <div
        ref={ref}
        className={`h-10 w-full rounded ${isStep9 ? 'ring-2 ring-border-primary ring-offset-1 ring-offset-background' : ''}`}
        style={{ background: `var(${varName})` }}
      />
      <span className="font-mono text-[9px] leading-none text-foreground-passive">{step}</span>
    </div>
  );
}

function ContrastSwatch({ scale }: { scale: ScaleName }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ref.current) {
      const val = getComputedStyle(ref.current).backgroundColor;
      if (val !== resolved) setResolved(val);
    }
  });

  return (
    <div
      className="flex flex-col items-center gap-1"
      title={`--${scale}-contrast\n${resolved}`}
    >
      <div
        ref={ref}
        className="h-10 w-full rounded"
        style={{
          background: `var(--${scale}-contrast)`,
          outline: '1px solid var(--border)',
        }}
      />
      <span className="font-mono text-[9px] leading-none text-foreground-passive">ctrst</span>
    </div>
  );
}

// ── Scale row ─────────────────────────────────────────────────────────────────

function ScaleRow({ scale }: { scale: ScaleName }) {
  return (
    <div className="flex items-start gap-2">
      {/* Scale label */}
      <div className="w-16 shrink-0 pt-3">
        <span className="font-mono text-xs font-medium text-foreground">{scale}</span>
      </div>

      {/* 12 steps */}
      <div className="grid flex-1 grid-cols-12 gap-1">
        {STEPS.map((step) => (
          <StepSwatch key={step} scale={scale} step={step} />
        ))}
      </div>

      {/* Contrast swatch */}
      <div className="w-12 shrink-0">
        <ContrastSwatch scale={scale} />
      </div>
    </div>
  );
}

// ── Header row ────────────────────────────────────────────────────────────────

function HeaderRow() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 shrink-0" />
      <div className="grid flex-1 grid-cols-12 gap-1">
        {STEPS.map((step) => (
          <div key={step} className="text-center font-mono text-[9px] text-foreground-passive">
            {step}
          </div>
        ))}
      </div>
      <div className="w-12 shrink-0 text-center font-mono text-[9px] text-foreground-passive">
        C
      </div>
    </div>
  );
}

// ── Full palette grid ─────────────────────────────────────────────────────────

function PaletteGrid() {
  return (
    <div className="flex flex-col gap-3 bg-background p-6">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-foreground">Color Palette</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Generated from OKLCH hue seeds with APCA-targeted contrast. Step 9 (ringed) is the solid
          fill. &quot;C&quot; is the auto-selected contrast text color for use on step 9. Hover a
          swatch for the CSS variable name and computed value.
        </p>
      </div>
      <HeaderRow />
      <div className="flex flex-col gap-2">
        {SCALE_NAMES.map((scale) => (
          <ScaleRow key={scale} scale={scale} />
        ))}
      </div>
    </div>
  );
}

// ── Storybook ─────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Theme/Palette',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

/** All palette scales — responds to the Light / Dark toolbar. */
export const Palette: Story = {
  render: () => <PaletteGrid />,
};

/** Light and dark palettes rendered side-by-side for visual parity check. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen">
      <div className="emlight flex-1">
        <div className="border-b border-border bg-background px-6 py-3 text-sm font-medium text-foreground">
          Light
        </div>
        <PaletteGrid />
      </div>
      <div className="emdark flex-1">
        <div className="border-b border-border bg-background px-6 py-3 text-sm font-medium text-foreground">
          Dark
        </div>
        <PaletteGrid />
      </div>
    </div>
  ),
};
