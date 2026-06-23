import type { Meta, StoryObj } from '@storybook/react-vite';
import { SCALE_NAMES, STEPS } from '@theme/core/contract/roles';
import React, { useEffect, useRef, useState } from 'react';
import { ThemeProvider } from '../primitives/theme-provider';
import * as s from '../story-layout.css';

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
    <div
      className={`${s.flex} ${s.flexCol} ${s.itemsCenter} ${s.gap1}`}
      title={`${varName}\n${resolved}`}
    >
      <div
        ref={ref}
        className={`${s.h10} ${s.wFull} ${s.rounded}`}
        style={{
          background: `var(${varName})`,
          boxShadow: isStep9
            ? '0 0 0 2px var(--background), 0 0 0 4px var(--border-primary)'
            : undefined,
        }}
      />
      <span className={`${s.fontMono} ${s.text9px} ${s.leadingNone} ${s.textForegroundPassive}`}>
        {step}
      </span>
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
      className={`${s.flex} ${s.flexCol} ${s.itemsCenter} ${s.gap1}`}
      title={`--${scale}-contrast\n${resolved}`}
    >
      <div
        ref={ref}
        className={`${s.h10} ${s.wFull} ${s.rounded}`}
        style={{
          background: `var(--${scale}-contrast)`,
          outline: '1px solid var(--border)',
        }}
      />
      <span className={`${s.fontMono} ${s.text9px} ${s.leadingNone} ${s.textForegroundPassive}`}>
        ctrst
      </span>
    </div>
  );
}

// ── Scale row ─────────────────────────────────────────────────────────────────

function ScaleRow({ scale }: { scale: ScaleName }) {
  return (
    <div className={`${s.flex} ${s.itemsStart} ${s.gap2}`}>
      <div className={`${s.w16} ${s.shrink0} ${s.pt3}`}>
        <span className={`${s.fontMono} ${s.textXs} ${s.fontMedium} ${s.textForeground}`}>
          {scale}
        </span>
      </div>

      <div className={`${s.grid} ${s.flex1} ${s.cols12} ${s.gap1}`}>
        {STEPS.map((step) => (
          <StepSwatch key={step} scale={scale} step={step} />
        ))}
      </div>

      <div className={`${s.w12} ${s.shrink0}`}>
        <ContrastSwatch scale={scale} />
      </div>
    </div>
  );
}

// ── Header row ────────────────────────────────────────────────────────────────

function HeaderRow() {
  return (
    <div className={`${s.flex} ${s.itemsCenter} ${s.gap2}`}>
      <div className={`${s.w16} ${s.shrink0}`} />
      <div className={`${s.grid} ${s.flex1} ${s.cols12} ${s.gap1}`}>
        {STEPS.map((step) => (
          <div
            key={step}
            className={`${s.textCenter} ${s.fontMono} ${s.text9px} ${s.textForegroundPassive}`}
          >
            {step}
          </div>
        ))}
      </div>
      <div
        className={`${s.w12} ${s.shrink0} ${s.textCenter} ${s.fontMono} ${s.text9px} ${s.textForegroundPassive}`}
      >
        C
      </div>
    </div>
  );
}

// ── Full palette grid ─────────────────────────────────────────────────────────

function PaletteGrid() {
  return (
    <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.bgBackground} ${s.p6}`}>
      <div className={s.mb2}>
        <h2 className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>Color Palette</h2>
        <p className={`${s.mt1} ${s.textXs} ${s.textForegroundMuted}`}>
          Generated from OKLCH hue seeds with APCA-targeted contrast. Step 9 (ringed) is the solid
          fill. &quot;C&quot; is the auto-selected contrast text color for use on step 9. Hover a
          swatch for the CSS variable name and computed value.
        </p>
      </div>
      <HeaderRow />
      <div className={`${s.flex} ${s.flexCol} ${s.gap2}`}>
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
    <div className={`${s.flex} ${s.minHScreen}`}>
      <ThemeProvider defaultTheme="light" className={s.flex1}>
        <div
          className={`${s.borderB} ${s.borderBorder} ${s.bgBackground} ${s.px6} ${s.py3} ${s.textSm} ${s.fontMedium} ${s.textForeground}`}
        >
          Light
        </div>
        <PaletteGrid />
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className={s.flex1}>
        <div
          className={`${s.borderB} ${s.borderBorder} ${s.bgBackground} ${s.px6} ${s.py3} ${s.textSm} ${s.fontMedium} ${s.textForeground}`}
        >
          Dark
        </div>
        <PaletteGrid />
      </ThemeProvider>
    </div>
  ),
};
