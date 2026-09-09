import { Badge, type BadgeTone, type BadgeVariant } from '@react/primitives/badge';
import { Icon } from '@react/primitives/icon';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { GitBranchIcon } from 'lucide-react';
const TONES: BadgeTone[] = ['neutral', 'success', 'warning', 'error', 'info'];
const VARIANTS: BadgeVariant[] = ['soft', 'outline'];
const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  args: {
    children: 'Badge',
  },
};
export default meta;
type Story = StoryObj<typeof Badge>;
export const Default: Story = {};
export const Matrix: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: '3',
      })}
    >
      {VARIANTS.map((variant) => (
        <div
          key={variant}
          className={sx({
            display: 'flex',
            alignItems: 'center',
            gap: '2',
          })}
        >
          {TONES.map((tone) => (
            <Badge key={tone} variant={variant} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  ),
};
export const WithIcon: Story = {
  render: () => (
    <Badge>
      <Icon source={GitBranchIcon} />
      main
    </Badge>
  ),
};
export const PolymorphicRender: Story = {
  render: () => (
    <Badge tone="info" render={<a href="#docs" />}>
      Rendered as anchor
    </Badge>
  ),
};
export const CountBadge: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '2',
      })}
    >
      <span style={{ fontSize: 'var(--em-text-sm)' }}>Local</span>
      <Badge>12</Badge>
    </div>
  ),
};
