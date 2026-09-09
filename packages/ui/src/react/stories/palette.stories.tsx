import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import React, { useEffect, useRef, useState } from 'react';
import { StoryThemeScope } from '../story-theme';
import * as s from '../story-layout.css';

type ScaleName = keyof typeof tokens.palette;

const SCALE_NAMES = Object.keys(tokens.palette) as ScaleName[];
const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function StepSwatch({ scale, step }: { scale: ScaleName; step: number }) {
  const tokenPath = `tokens.palette.${scale}.step${step}`;
  const tokenReference =
    tokens.palette[scale][`step${step}` as keyof (typeof tokens.palette)[ScaleName]];
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    if (ref.current) {
      const val = getComputedStyle(ref.current).backgroundColor;
      setResolved((prev) => (val !== prev ? val : prev));
    }
  }, []);
  const isStep9 = step === 9;
  return (
    <div
      title={`${tokenPath}\n${tokenReference}\n${resolved}`}
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1',
      })}
    >
      <div
        ref={ref}
        style={{
          background: tokenReference,
          boxShadow: isStep9
            ? `0 0 0 2px ${tokens.surface.current.background}, 0 0 0 4px ${tokens.border.focus}`
            : undefined,
        }}
        className={cx(
          s.h10,
          sx({
            width: 'full',
            rounded: 'sm',
          })
        )}
      />
      <span
        className={cx(
          sx({ fontFamily: 'mono', lineHeight: 'none', color: 'foregroundPassive' }),
          s.text9px
        )}
      >
        {step}
      </span>
    </div>
  );
}
function ContrastSwatch({ scale }: { scale: ScaleName }) {
  const tokenReference = tokens.palette[scale].contrast;
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    if (ref.current) {
      const val = getComputedStyle(ref.current).backgroundColor;
      setResolved((prev) => (val !== prev ? val : prev));
    }
  }, []);
  return (
    <div
      title={`tokens.palette.${scale}.contrast\n${tokenReference}\n${resolved}`}
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1',
      })}
    >
      <div
        ref={ref}
        style={{
          background: tokenReference,
          outline: `1px solid ${tokens.border.default}`,
        }}
        className={cx(
          s.h10,
          sx({
            width: 'full',
            rounded: 'sm',
          })
        )}
      />
      <span
        className={cx(
          sx({ fontFamily: 'mono', lineHeight: 'none', color: 'foregroundPassive' }),
          s.text9px
        )}
      >
        ctrst
      </span>
    </div>
  );
}
function ScaleRow({ scale }: { scale: ScaleName }) {
  return (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'flex-start',
        gap: '2',
      })}
    >
      <div
        className={cx(
          s.w16,
          sx({
            paddingTop: '3',
            flexShrink: 0,
          })
        )}
      >
        <span className={cx(sx({ fontFamily: 'mono', fontSize: 'xs', color: 'foreground' }))}>
          {scale}
        </span>
      </div>

      <div
        className={cx(
          cx(s.cols12),
          sx({
            display: 'grid',
            flex: '1',
            gap: '1',
          })
        )}
      >
        {STEPS.map((step) => (
          <StepSwatch key={step} scale={scale} step={step} />
        ))}
      </div>

      <div
        className={cx(
          s.w12,
          sx({
            flexShrink: 0,
          })
        )}
      >
        <ContrastSwatch scale={scale} />
      </div>
    </div>
  );
}
function HeaderRow() {
  return (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '2',
      })}
    >
      <div
        className={cx(
          s.w16,
          sx({
            flexShrink: 0,
          })
        )}
      />
      <div
        className={cx(
          s.cols12,
          sx({
            display: 'grid',
            flex: '1',
            gap: '1',
          })
        )}
      >
        {STEPS.map((step) => (
          <div
            key={step}
            className={cx(
              sx({ textAlign: 'center', fontFamily: 'mono', color: 'foregroundPassive' }),
              s.text9px
            )}
          >
            {step}
          </div>
        ))}
      </div>
      <div
        className={cx(
          s.w12,
          s.text9px,
          sx({
            flexShrink: 0,
            textAlign: 'center',
            fontFamily: 'mono',
            color: 'foregroundPassive',
          })
        )}
      >
        C
      </div>
    </div>
  );
}
function PaletteGrid() {
  return (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: '3',
        background: 'background',
        padding: '6',
      })}
    >
      <div
        className={sx({
          marginBottom: '2',
        })}
      >
        <h2 className={cx(sx({ fontSize: 'sm', color: 'foreground' }))}>Color Palette</h2>
        <p className={cx(sx({ marginTop: '1', fontSize: 'xs', color: 'foregroundMuted' }))}>
          Generated from OKLCH hue seeds with APCA-targeted contrast. Step 9 (ringed) is the solid
          fill. &quot;C&quot; is the auto-selected contrast text color for use on step 9. Hover a
          swatch for its author-facing Token path, implementation reference, and computed value.
        </p>
      </div>
      <HeaderRow />
      <div
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '2',
        })}
      >
        {SCALE_NAMES.map((scale) => (
          <ScaleRow key={scale} scale={scale} />
        ))}
      </div>
    </div>
  );
}
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
    <div
      className={cx(
        s.minHScreen,
        sx({
          display: 'flex',
        })
      )}
    >
      <StoryThemeScope colorScheme="light" className={cx(sx({ flex: '1' }))}>
        <div
          className={sx({
            borderBottomWidth: '1',
            borderStyle: 'solid',
            borderColor: 'border',
            background: 'background',
            px: '6',
            py: '3',
            fontSize: 'sm',
            color: 'foreground',
          })}
        >
          Light
        </div>
        <PaletteGrid />
      </StoryThemeScope>
      <StoryThemeScope colorScheme="dark" className={cx(sx({ flex: '1' }))}>
        <div
          className={sx({
            borderBottomWidth: '1',
            borderStyle: 'solid',
            borderColor: 'border',
            background: 'background',
            px: '6',
            py: '3',
            fontSize: 'sm',
            color: 'foreground',
          })}
        >
          Dark
        </div>
        <PaletteGrid />
      </StoryThemeScope>
    </div>
  ),
};
