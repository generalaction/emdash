import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import * as s from '../story-layout.css';

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
    <div className={`${s.flex} ${s.flexCol} ${s.gap6} ${s.p4}`}>
      <div>
        <h2 className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>Radius scale</h2>
        <p className={`${s.mt1} ${s.textXs} ${s.textForegroundMuted}`}>
          Each swatch uses <code className={s.fontMono}>border-radius: var(--radius-*)</code>. The
          anchor is <code className={s.fontMono}>--radius: 0.5rem</code>; change it to rescale the
          whole system.
        </p>
      </div>
      <div className={`${s.grid} ${s.cols4} ${s.gap6} ${s.lgCols7}`}>
        {RADIUS_TOKENS.map(({ name, var: cssVar, label }) => (
          <div key={name} className={`${s.flex} ${s.flexCol} ${s.itemsCenter} ${s.gap3}`}>
            <div
              className={`${s.bgSurfaceBaseEmphasis} ${s.h16} ${s.w16} ${s.border2} ${s.borderBorder}`}
              style={{ borderRadius: `var(${cssVar})` }}
            />
            <div className={s.textCenter}>
              <p className={`${s.fontMono} ${s.textXs} ${s.fontMedium} ${s.textForeground}`}>
                {cssVar}
              </p>
              <p className={`${s.mt05} ${s.fontMono} ${s.text10px} ${s.textForegroundPassive}`}>
                {label}
              </p>
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
    <div className={`${s.flex} ${s.flexCol} ${s.gap6} ${s.p4}`}>
      <div>
        <h2 className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>Tokens in use</h2>
        <p className={`${s.mt1} ${s.textXs} ${s.textForegroundMuted}`}>
          Buttons use <code className={s.fontMono}>--radius-lg</code> (base) and{' '}
          <code className={s.fontMono}>--radius-md</code> (sm). Inputs use{' '}
          <code className={s.fontMono}>--radius-md</code>.
        </p>
      </div>
      <div className={`${s.flex} ${s.flexWrap} ${s.itemsCenter} ${s.gap3}`}>
        <button
          type="button"
          className={`${s.bgSurfaceHover} ${s.inlineFlex} ${s.h8} ${s.itemsCenter} ${s.gap15} ${s.roundedLg} ${s.border} ${s.borderTransparent} ${s.px25} ${s.textSm} ${s.textForeground}`}
        >
          Base button (--radius-lg)
        </button>
        <button
          type="button"
          className={`${s.bgSurfaceHover} ${s.inlineFlex} ${s.h6} ${s.itemsCenter} ${s.gap1} ${s.roundedMd} ${s.border} ${s.borderTransparent} ${s.px2} ${s.textXs} ${s.textForeground}`}
        >
          SM button (--radius-md)
        </button>
        <input
          type="text"
          placeholder="Input (--radius-md)"
          className={`${s.bgSurface} ${s.h8} ${s.roundedMd} ${s.border} ${s.borderBorder} ${s.px25} ${s.textSm} ${s.textForeground} ${s.outlineNone}`}
        />
      </div>
    </div>
  ),
};
