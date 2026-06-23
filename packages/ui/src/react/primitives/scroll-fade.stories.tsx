import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { cx } from '@styles/utilities/cx';
import { sx } from '@styles/utilities/sprinkles.css';
import { Box } from './box';
import { ScrollFade } from './scroll-fade';
import { Surface } from './surface';
import { ThemeProvider } from './theme-provider';
import * as s from '../story-layout.css';

const SURFACE_LEVELS = ['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const;

const meta: Meta<typeof ScrollFade> = {
  title: 'Primitives/ScrollFade',
  component: ScrollFade,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof ScrollFade>;

function Paragraph({ n = 1 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <p key={i} className={cx(sx({ fontSize: 'sm', color: 'foreground' }))}>
          Paragraph {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
          tempor incididunt ut labore et dolore magna aliqua.
        </p>
      ))}
    </>
  );
}

function HorizontalItems({ n = 20 }: { n?: number }) {
  return (
    <Box display="flex" gap="3" whiteSpace="nowrap">
      {Array.from({ length: n }, (_, i) => (
        <Box
          key={i}
          background="surfaceBaseEmphasis"
          rounded="sm"
          borderWidth="1"
          borderStyle="solid"
          borderColor="border"
          px="3"
          py="1"
          fontSize="sm"
        >
          Item {i + 1}
        </Box>
      ))}
    </Box>
  );
}

/** Vertical fade — content overflows, fades appear top and bottom as you scroll. */
export const VerticalOverflow: Story = {
  render: () => (
    <ScrollFade
      className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w80)}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={8} />
      </Box>
    </ScrollFade>
  ),
};

/** No overflow — fades should not appear when content fits. */
export const VerticalNoOverflow: Story = {
  render: () => (
    <ScrollFade
      className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w80)}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={2} />
      </Box>
    </ScrollFade>
  ),
};

/** Horizontal fade — wide content overflows horizontally. */
export const HorizontalOverflow: Story = {
  render: () => (
    <ScrollFade
      axis="x"
      className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.w80)}
    >
      <Box padding="4">
        <HorizontalItems n={20} />
      </Box>
    </ScrollFade>
  ),
};

/** Both axes — content overflows in both directions. */
export const BothAxes: Story = {
  render: () => (
    <ScrollFade
      axis="both"
      className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w80)}
    >
      <Box padding="4">
        <Box marginBottom="3">
          <HorizontalItems n={20} />
        </Box>
        <Paragraph n={8} />
      </Box>
    </ScrollFade>
  ),
};

/** Non-surface background — override --fade-color to match the container's paint. */
export const NonSurfaceBackground: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="4">
      <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>
        Code-block-style container: overrides <code>--fade-color</code> to match its background.
      </p>
      <ScrollFade
        className={cx(sx({ borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h40, s.w80)}
        fadeColor="var(--neutral-1)"
        style={{ background: 'var(--neutral-1)' }}
      >
        <pre className={cx(sx({ padding: '4', fontFamily: 'mono', fontSize: 'xs', color: 'foreground' }))}>
          {Array.from(
            { length: 20 },
            (_, i) => `const line${i + 1} = "some code value here";`
          ).join('\n')}
        </pre>
      </ScrollFade>
    </Box>
  ),
};

/** Custom fade size — larger gradient for a more dramatic effect. */
export const CustomSize: Story = {
  render: () => (
    <Box display="flex" gap="6">
      <Box display="flex" flexDirection="column" gap="1">
        <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>size=12 (subtle)</p>
        <ScrollFade
          size={12}
          className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w52)}
        >
          <Box display="flex" flexDirection="column" gap="3" padding="4">
            <Paragraph n={8} />
          </Box>
        </ScrollFade>
      </Box>
      <Box display="flex" flexDirection="column" gap="1">
        <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>size=48 (dramatic)</p>
        <ScrollFade
          size={48}
          className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w52)}
        >
          <Box display="flex" flexDirection="column" gap="3" padding="4">
            <Paragraph n={8} />
          </Box>
        </ScrollFade>
      </Box>
    </Box>
  ),
};

/** All surface elevations side-by-side — verifies automatic surface-cascade color matching. */
export const AllSurfaces: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" gap="4">
      {SURFACE_LEVELS.map((level) => (
        <Surface key={level} level={level} className={cx(sx({ rounded: 'lg', padding: '4' }))}>
          <p className={cx(sx({ marginBottom: '2', fontSize: 'xs', color: 'foregroundMuted' }))}>
            .surface-{level}
          </p>
          <ScrollFade
            className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h40, s.w44)}
          >
            <Box display="flex" flexDirection="column" gap="3" padding="3">
              <Paragraph n={8} />
            </Box>
          </ScrollFade>
        </Surface>
      ))}
    </Box>
  ),
};

/** Light and dark side-by-side — fade color adapts to mode via the surface cascade. */
export const BothModes: Story = {
  render: () => (
    <Box display="flex" className={cx(s.minHScreen, s.divideX, s.divideBorder)}>
      <ThemeProvider defaultTheme="light" className={cx(sx({ flex: '1', background: 'background', padding: '8' }))}>
        <p className={cx(sx({ marginBottom: '4', fontSize: 'sm', fontWeight: 'medium', color: 'foreground' }))}>Light mode</p>
        <ScrollFade
          className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w80)}
        >
          <Box display="flex" flexDirection="column" gap="3" padding="4">
            <Paragraph n={8} />
          </Box>
        </ScrollFade>
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className={cx(sx({ flex: '1', background: 'background', padding: '8' }))}>
        <p className={cx(sx({ marginBottom: '4', fontSize: 'sm', fontWeight: 'medium', color: 'foreground' }))}>Dark mode</p>
        <ScrollFade
          className={cx(sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }), s.h48, s.w80)}
        >
          <Box display="flex" flexDirection="column" gap="3" padding="4">
            <Paragraph n={8} />
          </Box>
        </ScrollFade>
      </ThemeProvider>
    </Box>
  ),
};
