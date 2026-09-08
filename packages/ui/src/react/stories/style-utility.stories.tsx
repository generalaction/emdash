import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';

const meta = {
  title: 'Theme/Style Utility',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** `sx()` is the sole public Style Utility for finite static layout and overrides. */
export const Layout: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step4,
        p: tokens.space.step4,
      })}
    >
      <section
        className={cx(
          surface({ level: 'base' }),
          sx({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space.step2,
            borderRadius: tokens.radius.md,
            p: tokens.space.step3,
          })
        )}
      >
        <span>Recipe-owned Surface</span>
        <span className={sx({ color: tokens.foreground.muted })}>Utility-owned local layout</span>
      </section>

      <ul
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.step2,
          p: tokens.space.step0,
        })}
      >
        {(['destructive', 'warning', 'info'] as const).map((tone) => (
          <li
            key={tone}
            className={cx(
              surface({ tone }),
              sx({
                borderRadius: tokens.radius.sm,
                p: tokens.space.step2,
              })
            )}
          >
            {tone}
          </li>
        ))}
      </ul>
    </div>
  ),
};

/**
 * Caller `sx()` classes belong on the documented rendered root. The Utility
 * layer intentionally wins for these finite, local properties; component
 * interaction states remain Recipe-owned.
 */
export const ComponentRootOverrides: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step3,
      })}
    >
      <Input placeholder="Caller-owned width" className={sx({ width: 'full' })} />
      <Button variant="primary" className={sx({ width: 'full', marginTop: tokens.space.step2 })}>
        Save
      </Button>
    </div>
  ),
};
