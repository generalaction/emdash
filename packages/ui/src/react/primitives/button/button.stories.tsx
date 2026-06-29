import { Box } from '@react/primitives/box';
import { Button } from '@react/primitives/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon, SearchIcon, TrashIcon } from 'lucide-react';
import * as s from '@react/story-layout.css';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: ['ghost', 'primary'] },
    tone: { control: 'select', options: ['neutral', 'destructive'] },
    size: { control: 'select', options: ['base', 'sm', 'link'] },
    icon: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'ghost' },
};

/** All variants × tones. */
export const VariantMatrix: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3">
      {(['ghost', 'primary'] as const).map((variant) => (
        <Box key={variant} display="flex" flexWrap="wrap" alignItems="center" gap="2">
          {(['neutral', 'destructive'] as const).map((tone) => (
            <Button key={tone} variant={variant} tone={tone}>
              {variant} / {tone}
            </Button>
          ))}
        </Box>
      ))}
    </Box>
  ),
};

/** Base (32 px) and SM (24 px) sizes, plus Link. */
export const Sizes: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3">
      <Box display="flex" flexWrap="wrap" alignItems="flex-end" gap="2">
        <Button size="base">Base</Button>
        <Button size="sm">Small</Button>
        <Button size="link">Link</Button>
      </Box>
      <Box display="flex" flexWrap="wrap" alignItems="flex-end" gap="2">
        <Button size="base" icon>
          <SearchIcon />
        </Button>
        <Button size="sm" icon>
          <SearchIcon />
        </Button>
      </Box>
    </Box>
  ),
};

/** Icon-only icon buttons. */
export const IconButtons: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="2">
      <Button icon>
        <PlusIcon />
      </Button>
      <Button icon variant="primary">
        <PlusIcon />
      </Button>
      <Button icon size="sm">
        <SearchIcon />
      </Button>
      <Button icon tone="destructive">
        <TrashIcon />
      </Button>
    </Box>
  ),
};

/** Disabled state. */
export const Disabled: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="2">
      <Button disabled>Ghost</Button>
      <Button variant="primary" disabled>
        Primary
      </Button>
      <Button tone="destructive" disabled>
        Destructive
      </Button>
    </Box>
  ),
};

/** Surface-relative hover / active adapt correctly across all backgrounds. */
export const AcrossSurfaces: Story = {
  render: () => (
    <Box
      background="surfaceSunken"
      display="flex"
      flexDirection="column"
      gap="4"
      rounded="xl"
      padding="4"
    >
      {(['sunken', 'base', 'base-emphasis', 'elevated', 'elevated-emphasis'] as const).map(
        (level) => (
          <Box
            key={level}
            surface={level}
            display="flex"
            flexWrap="wrap"
            alignItems="center"
            gap="2"
            rounded="lg"
            padding="3"
          >
            <span
              className={s.w36}
              style={{ fontSize: 'var(--text-xs)', color: 'var(--foreground-muted)' }}
            >
              {level}
            </span>
            <Button>Ghost</Button>
            <Button variant="primary">Primary</Button>
            <Button tone="destructive">Destructive</Button>
            <Button icon>
              <SearchIcon />
            </Button>
          </Box>
        )
      )}
    </Box>
  ),
};
