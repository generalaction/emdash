import { Box } from '@react/primitives/box';
import { Button } from '@react/primitives/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '@styles/utilities/cx';
import { Dialog, type DialogSize } from '.';
import { sx } from '@styles/utilities/sprinkles.css';

const meta: Meta = {
  title: 'Primitives/Dialog',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="ghost">Open dialog</Button>} />
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Dialog title</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This is the dialog body. Place forms, content, or any composition here. The body scrolls
            independently when it overflows.
          </p>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
          <Dialog.Close render={<Button variant="primary">Save</Button>} />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

const SIZES: { size: DialogSize; label: string; width: string }[] = [
  { size: 'xs', label: 'Extra small', width: '20rem (320px)' },
  { size: 'sm', label: 'Small', width: '24rem (384px)' },
  { size: 'md', label: 'Medium (default)', width: '32rem (512px)' },
  { size: 'lg', label: 'Large', width: '42rem (672px)' },
  { size: 'xl', label: 'Extra large', width: '80% width / 80vh tall' },
];

export const Sizes: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" gap="3">
      {SIZES.map(({ size, label, width }) => (
        <Dialog.Root key={size}>
          <Dialog.Trigger render={<Button variant="ghost">{label}</Button>} />
          <Dialog.Content size={size}>
            <Dialog.Header>
              <Dialog.Title>{label}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <p className={cx(sx({ color: 'foregroundMuted' }))}>
                This dialog uses the <code>{size}</code> size option (<code>{width}</code>),
                matching the emdash-desktop modal sizes.
              </p>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.Close render={<Button variant="ghost">Close</Button>} />
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      ))}
    </Box>
  ),
};

export const Confirmation: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="ghost">Delete item</Button>} />
      <Dialog.Content size="xs">
        <Dialog.Header showCloseButton={false}>
          <Dialog.Title>Delete item?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This action cannot be undone. The item will be permanently removed.
          </p>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
          <Dialog.Close
            render={
              <Button variant="primary" tone="destructive">
                Delete
              </Button>
            }
          />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

export const ExtraLarge: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="ghost">Open XL dialog</Button>} />
      <Dialog.Content size="xl">
        <Dialog.Header>
          <Dialog.Title>Extra large dialog</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            The <code>xl</code> size takes up to 80% of the viewport width and is 80vh tall — useful
            for content-heavy views like previews, diffs, or browsers.
          </p>
          {Array.from({ length: 24 }, (_, i) => (
            <p key={i} className={cx(sx({ color: 'foregroundMuted' }))}>
              {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </p>
          ))}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">Close</Button>} />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

export const ScrollableBody: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="ghost">Open long dialog</Button>} />
      <Dialog.Content size="md">
        <Dialog.Header>
          <Dialog.Title>Terms of service</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body maxHeight="50vh">
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i} className={cx(sx({ color: 'foregroundMuted' }))}>
              {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
              tempor incididunt ut labore et dolore magna aliqua.
            </p>
          ))}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">Decline</Button>} />
          <Dialog.Close render={<Button variant="primary">Accept</Button>} />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  ),
};
