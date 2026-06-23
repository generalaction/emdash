import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { cx } from '@styles/utilities/cx';
import { sx } from '@styles/utilities/sprinkles.css';
import { Box } from './box';
import { ScrollContainer } from './scroll-container';
import { Surface } from './surface';
import { ThemeProvider } from './theme-provider';
import * as s from '../story-layout.css';

const SURFACE_LEVELS = ['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const;

const meta: Meta<typeof ScrollContainer> = {
  title: 'Primitives/ScrollContainer',
  component: ScrollContainer,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof ScrollContainer>;

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

/**
 * Content overflows — both top and bottom fades appear as you scroll.
 * This is the key difference from ScrollFade: the bottom fade is absent
 * when the container is at rest (not yet scrolled) only while the content
 * actually overflows.
 */
export const WithOverflow: Story = {
  render: () => (
    <ScrollContainer
      maxHeight={192}
      className={cx(
        sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
        s.w80
      )}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={8} />
      </Box>
    </ScrollContainer>
  ),
};

/**
 * Content fits — no fades are rendered at all because the ResizeObserver
 * detects no overflow.
 */
export const NoOverflow: Story = {
  render: () => (
    <ScrollContainer
      maxHeight={192}
      className={cx(
        sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
        s.w80
      )}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={2} />
      </Box>
    </ScrollContainer>
  ),
};

/**
 * Top fade disabled — scrolling down still shows the bottom fade, but
 * no top fade appears after scrolling down.
 */
export const TopFadeDisabled: Story = {
  render: () => (
    <ScrollContainer
      maxHeight={192}
      topFade={false}
      className={cx(
        sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
        s.w80
      )}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={8} />
      </Box>
    </ScrollContainer>
  ),
};

/**
 * Bottom fade disabled — the top fade still appears after scrolling, but
 * no bottom fade shows at the initial position.
 */
export const BottomFadeDisabled: Story = {
  render: () => (
    <ScrollContainer
      maxHeight={192}
      bottomFade={false}
      className={cx(
        sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
        s.w80
      )}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={8} />
      </Box>
    </ScrollContainer>
  ),
};

/** Both fades disabled — scrollable but no gradient overlays. */
export const BothFadesDisabled: Story = {
  render: () => (
    <ScrollContainer
      maxHeight={192}
      topFade={false}
      bottomFade={false}
      className={cx(
        sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
        s.w80
      )}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={8} />
      </Box>
    </ScrollContainer>
  ),
};

/** String maxHeight — CSS value passed directly (e.g. '50vh'). */
export const MaxHeightString: Story = {
  render: () => (
    <ScrollContainer
      maxHeight="50vh"
      className={cx(
        sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
        s.w80
      )}
    >
      <Box display="flex" flexDirection="column" gap="3" padding="4">
        <Paragraph n={16} />
      </Box>
    </ScrollContainer>
  ),
};

/**
 * All surface elevations side-by-side — the fade gradient automatically matches
 * the container background because --fade-color inherits from --surface via the
 * surface cascade. Each ScrollContainer sits inside a <Surface level=...> scope
 * that rebinds --surface, so both background and fade update together.
 */
export const SurfaceAware: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" gap="4">
      {SURFACE_LEVELS.map((level) => (
        <Surface key={level} level={level} className={cx(sx({ rounded: 'lg', padding: '4' }))}>
          <p className={cx(sx({ marginBottom: '2', fontSize: 'xs', color: 'foregroundMuted' }))}>
            .surface-{level}
          </p>
          <ScrollContainer
            maxHeight={160}
            className={cx(
              sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
              s.w44
            )}
          >
            <Box display="flex" flexDirection="column" gap="3" padding="3">
              <Paragraph n={8} />
            </Box>
          </ScrollContainer>
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
        <p className={cx(sx({ marginBottom: '4', fontSize: 'sm', fontWeight: 'medium', color: 'foreground' }))}>
          Light mode
        </p>
        <ScrollContainer
          maxHeight={192}
          className={cx(
            sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
            s.w80
          )}
        >
          <Box display="flex" flexDirection="column" gap="3" padding="4">
            <Paragraph n={8} />
          </Box>
        </ScrollContainer>
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className={cx(sx({ flex: '1', background: 'background', padding: '8' }))}>
        <p className={cx(sx({ marginBottom: '4', fontSize: 'sm', fontWeight: 'medium', color: 'foreground' }))}>
          Dark mode
        </p>
        <ScrollContainer
          maxHeight={192}
          className={cx(
            sx({ background: 'surface', borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
            s.w80
          )}
        >
          <Box display="flex" flexDirection="column" gap="3" padding="4">
            <Paragraph n={8} />
          </Box>
        </ScrollContainer>
      </ThemeProvider>
    </Box>
  ),
};
