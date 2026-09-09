import { Spinner, type SpinnerSize } from '@react/primitives/spinner';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
const SIZES: SpinnerSize[] = ['sm', 'md', 'lg'];
const meta: Meta<typeof Spinner> = {
  title: 'Primitives/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof Spinner>;
export const Default: Story = {};
export const Sizes: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '4',
      })}
    >
      {SIZES.map((size) => (
        <div
          key={size}
          className={sx({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2',
          })}
        >
          <Spinner size={size} />
          <span style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}>
            {size}
          </span>
        </div>
      ))}
    </div>
  ),
};
export const InheritsColor: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '4',
      })}
    >
      <span style={{ color: 'var(--em-foreground-muted)' }}>
        <Spinner />
      </span>
      <span style={{ color: 'var(--em-foreground-success)' }}>
        <Spinner />
      </span>
      <span style={{ color: 'var(--em-foreground-error)' }}>
        <Spinner />
      </span>
    </div>
  ),
};
export const WithLabel: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '2',
      })}
    >
      <Spinner size="sm" />
      <span style={{ fontSize: 'var(--em-text-sm)', color: 'var(--em-foreground-muted)' }}>
        Loading workspaces…
      </span>
    </div>
  ),
};
