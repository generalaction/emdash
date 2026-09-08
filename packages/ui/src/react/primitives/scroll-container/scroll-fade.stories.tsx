import { StoryThemeScope } from '@react/story-theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { Surface } from '@/react/primitives/surface/surface';
import { ScrollFade } from './scroll-fade';
import * as s from '@react/story-layout.css';
const SURFACE_LEVELS = ['sunken', 'base', 'raised', 'elevated', 'overlay'] as const;
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
/** Vertical fade — content overflows, the top fade appears as you scroll down. */
export const VerticalOverflow: Story = {
  render: () => (
    <ScrollFade
      className={cx(
        sx({
          background: 'surface',
          borderWidth: '1',
          borderStyle: 'solid',
          borderColor: 'border',
          rounded: 'sm',
        }),
        s.h48,
        s.w80
      )}
    >
      <div
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
          padding: '4',
        })}
      >
        <Paragraph n={8} />
      </div>
    </ScrollFade>
  ),
};
/** No overflow — the top fade should not appear when content fits. */
export const VerticalNoOverflow: Story = {
  render: () => (
    <ScrollFade
      className={cx(
        sx({
          background: 'surface',
          borderWidth: '1',
          borderStyle: 'solid',
          borderColor: 'border',
          rounded: 'sm',
        }),
        s.h48,
        s.w80
      )}
    >
      <div
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
          padding: '4',
        })}
      >
        <Paragraph n={2} />
      </div>
    </ScrollFade>
  ),
};
/**
 * Non-surface background — the mask approach is color-agnostic, so no
 * --fade-color override is needed. The fade just works regardless of the
 * container background.
 */
export const NonSurfaceBackground: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: '4',
      })}
    >
      <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>
        Code-block-style container: mask-based fades work on any background color.
      </p>
      <ScrollFade
        className={cx(
          sx({ borderWidth: '1', borderStyle: 'solid', borderColor: 'border', rounded: 'sm' }),
          s.h40,
          s.w80
        )}
        style={{ background: 'var(--em-neutral-1)' }}
      >
        <pre
          className={cx(
            sx({ padding: '4', fontFamily: 'mono', fontSize: 'xs', color: 'foreground' })
          )}
        >
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
    <div
      className={sx({
        display: 'flex',
        gap: '6',
      })}
    >
      <div
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '1',
        })}
      >
        <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>size=12 (subtle)</p>
        <ScrollFade
          size={12}
          className={cx(
            sx({
              background: 'surface',
              borderWidth: '1',
              borderStyle: 'solid',
              borderColor: 'border',
              rounded: 'sm',
            }),
            s.h48,
            s.w52
          )}
        >
          <div
            className={sx({
              display: 'flex',
              flexDirection: 'column',
              gap: '3',
              padding: '4',
            })}
          >
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
      <div
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '1',
        })}
      >
        <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>size=48 (dramatic)</p>
        <ScrollFade
          size={48}
          className={cx(
            sx({
              background: 'surface',
              borderWidth: '1',
              borderStyle: 'solid',
              borderColor: 'border',
              rounded: 'sm',
            }),
            s.h48,
            s.w52
          )}
        >
          <div
            className={sx({
              display: 'flex',
              flexDirection: 'column',
              gap: '3',
              padding: '4',
            })}
          >
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </div>
    </div>
  ),
};
/** All surface elevations side-by-side — the mask-based fade is color-agnostic and works on every surface. */
export const AllSurfaces: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4',
      })}
    >
      {SURFACE_LEVELS.map((level) => (
        <Surface key={level} level={level} className={cx(sx({ rounded: 'lg', padding: '4' }))}>
          <p className={cx(sx({ marginBottom: '2', fontSize: 'xs', color: 'foregroundMuted' }))}>
            .surface-{level}
          </p>
          <ScrollFade
            className={cx(
              sx({
                background: 'surface',
                borderWidth: '1',
                borderStyle: 'solid',
                borderColor: 'border',
                rounded: 'sm',
              }),
              s.h40,
              s.w44
            )}
          >
            <div
              className={sx({
                display: 'flex',
                flexDirection: 'column',
                gap: '3',
                padding: '3',
              })}
            >
              <Paragraph n={8} />
            </div>
          </ScrollFade>
        </Surface>
      ))}
    </div>
  ),
};
/** Light and dark side-by-side — the mask-based top fade works identically in both modes. */
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
      <StoryThemeScope
        colorScheme="light"
        className={cx(sx({ flex: '1', background: 'background', padding: '8' }))}
      >
        <p className={cx(sx({ marginBottom: '4', fontSize: 'sm', color: 'foreground' }))}>
          Light mode
        </p>
        <ScrollFade
          className={cx(
            sx({
              background: 'surface',
              borderWidth: '1',
              borderStyle: 'solid',
              borderColor: 'border',
              rounded: 'sm',
            }),
            s.h48,
            s.w80
          )}
        >
          <div
            className={sx({
              display: 'flex',
              flexDirection: 'column',
              gap: '3',
              padding: '4',
            })}
          >
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </StoryThemeScope>
      <StoryThemeScope
        colorScheme="dark"
        className={cx(s.borderLeft, sx({ flex: '1', background: 'background', padding: '8' }))}
      >
        <p className={cx(sx({ marginBottom: '4', fontSize: 'sm', color: 'foreground' }))}>
          Dark mode
        </p>
        <ScrollFade
          className={cx(
            sx({
              background: 'surface',
              borderWidth: '1',
              borderStyle: 'solid',
              borderColor: 'border',
              rounded: 'sm',
            }),
            s.h48,
            s.w80
          )}
        >
          <div
            className={sx({
              display: 'flex',
              flexDirection: 'column',
              gap: '3',
              padding: '4',
            })}
          >
            <Paragraph n={8} />
          </div>
        </ScrollFade>
      </StoryThemeScope>
    </div>
  ),
};
