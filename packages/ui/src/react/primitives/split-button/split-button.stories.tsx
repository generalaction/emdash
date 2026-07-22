import { Box } from '@react/primitives/box';
import { SplitButton } from '@react/primitives/split-button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ButtonVariant } from '../button';

const buttonVariants: ButtonVariant[] = ['primary', 'destructive', 'secondary', 'ghost', 'link'];

const options = [
  { id: 'create', label: 'Create task' },
  { id: 'draft', label: 'Save as draft' },
  { id: 'schedule', label: 'Schedule later' },
];

const meta: Meta<typeof SplitButton> = {
  title: 'Primitives/SplitButton',
  component: SplitButton,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: buttonVariants },
    size: { control: 'select', options: ['base', 'sm'] },
    tone: { table: { disable: true } },
    disabled: { control: 'boolean' },
  },
  args: {
    options,
    selectedId: 'create',
    variant: 'primary',
    size: 'sm',
    onAction: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof SplitButton>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="2">
      {buttonVariants.map((variant) => (
        <SplitButton
          key={variant}
          options={options}
          selectedId="create"
          variant={variant}
          onAction={() => undefined}
        />
      ))}
    </Box>
  ),
};

