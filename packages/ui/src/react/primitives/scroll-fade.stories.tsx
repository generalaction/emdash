import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ScrollFade } from './scroll-fade';
import { ThemeProvider } from './theme-provider';
import * as s from '../story-layout.css';

const meta: Meta<typeof ScrollFade> = {
  title: 'Primitives/ScrollFade',
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
        <p key={i} className={`${s.textSm} ${s.textForeground}`}>
          Paragraph {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
          tempor incididunt ut labore et dolore magna aliqua.
        </p>
      ))}
    </>
  );
}

function HorizontalItems({ n = 20 }: { n?: number }) {
  return (
    <div className={`${s.flex} ${s.gap3} ${s.noWrap}`}>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className={`${s.bgSurfaceBaseEmphasis} ${s.rounded} ${s.border} ${s.borderBorder} ${s.px3} ${s.py1} ${s.textSm}`}
        >
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
    <ScrollFade
      className={`bg-surface ${s.h48} ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
    >
      <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p4}`}>
        <Paragraph n={8} />
      </div>
    </ScrollFade>
  ),
};

/** No overflow — fades should not appear when content fits. */
export const VerticalNoOverflow: Story = {
  render: () => (
    <ScrollFade
      className={`bg-surface ${s.h48} ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
    >
      <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p4}`}>
        <Paragraph n={2} />
      </div>
    </ScrollFade>
  ),
};

/** Horizontal fade — wide content overflows horizontally. */
export const HorizontalOverflow: Story = {
  render: () => (
    <ScrollFade
      axis="x"
      className={`bg-surface ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
    >
      <div className={s.p4}>
        <HorizontalItems n={20} />
      </div>
    </ScrollFade>
  ),
};

/** Both axes — content overflows in both directions. */
export const BothAxes: Story = {
  render: () => (
    <ScrollFade
      axis="both"
      className={`bg-surface ${s.h48} ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
    >
      <div className={s.p4}>
        <div className={s.mb3}>
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
    <div className={`${s.flex} ${s.flexCol} ${s.gap4}`}>
      <p className={`${s.textXs} ${s.textForegroundMuted}`}>
        Code-block-style container: overrides <code>--fade-color</code> to match its background.
      </p>
      <ScrollFade
        className={`${s.h40} ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
        fadeColor="var(--neutral-1)"
        style={{ background: 'var(--neutral-1)' }}
      >
        <pre className={`${s.p4} ${s.fontMono} ${s.textXs} ${s.textForeground}`}>
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
    <div className={`${s.flex} ${s.gap6}`}>
      <div className={`${s.flex} ${s.flexCol} ${s.gap1}`}>
        <p className={`${s.textXs} ${s.textForegroundMuted}`}>size=12 (subtle)</p>
        <ScrollFade
          size={12}
          className={`bg-surface ${s.h48} ${s.w52} ${s.rounded} ${s.border} ${s.borderBorder}`}
        >
          <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p4}`}>
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
      <div className={`${s.flex} ${s.flexCol} ${s.gap1}`}>
        <p className={`${s.textXs} ${s.textForegroundMuted}`}>size=48 (dramatic)</p>
        <ScrollFade
          size={48}
          className={`bg-surface ${s.h48} ${s.w52} ${s.rounded} ${s.border} ${s.borderBorder}`}
        >
          <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p4}`}>
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
    <div className={`${s.flex} ${s.flexWrap} ${s.gap4}`}>
      {(['sunken', 'base', 'raised', 'overlay', 'floating'] as const).map((sv) => (
        <div key={sv} className={`surface-${sv} ${s.roundedLg} ${s.p4}`}>
          <p className={`${s.mb2} ${s.textXs} ${s.textForegroundMuted}`}>.surface-{sv}</p>
          <ScrollFade
            className={`bg-surface ${s.h40} ${s.w44} ${s.rounded} ${s.border} ${s.borderBorder}`}
          >
            <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p3}`}>
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
    <div className={`${s.flex} ${s.minHScreen} ${s.divideX} ${s.divideBorder}`}>
      <ThemeProvider defaultTheme="light" className={`${s.flex1} ${s.bgBackground} ${s.p8}`}>
        <p className={`${s.mb4} ${s.textSm} ${s.fontMedium} ${s.textForeground}`}>Light mode</p>
        <ScrollFade
          className={`bg-surface ${s.h48} ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
        >
          <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p4}`}>
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className={`${s.flex1} ${s.bgBackground} ${s.p8}`}>
        <p className={`${s.mb4} ${s.textSm} ${s.fontMedium} ${s.textForeground}`}>Dark mode</p>
        <ScrollFade
          className={`bg-surface ${s.h48} ${s.w80} ${s.rounded} ${s.border} ${s.borderBorder}`}
        >
          <div className={`${s.flex} ${s.flexCol} ${s.gap3} ${s.p4}`}>
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </ThemeProvider>
    </div>
  ),
};
