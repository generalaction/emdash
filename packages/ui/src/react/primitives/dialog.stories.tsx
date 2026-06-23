import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { cx } from '@styles/utilities/cx';
import { sx } from '@styles/utilities/sprinkles.css';
import { Box } from './box';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogSize,
} from './dialog';

const meta: Meta = {
  title: 'Primitives/Dialog',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost">Open dialog</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dialog title</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This is the dialog body. Place forms, content, or any composition here. The body scrolls
            independently when it overflows.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <DialogClose render={<Button variant="primary">Save</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <Dialog key={size}>
          <DialogTrigger render={<Button variant="ghost">{label}</Button>} />
          <DialogContent size={size}>
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className={cx(sx({ color: 'foregroundMuted' }))}>
                This dialog uses the <code>{size}</code> size option (<code>{width}</code>),
                matching the emdash-desktop modal sizes.
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost">Close</Button>} />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}
    </Box>
  ),
};

export const Confirmation: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost">Delete item</Button>} />
      <DialogContent size="xs">
        <DialogHeader showCloseButton={false}>
          <DialogTitle>Delete item?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This action cannot be undone. The item will be permanently removed.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <DialogClose
            render={
              <Button variant="primary" tone="destructive">
                Delete
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const ExtraLarge: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost">Open XL dialog</Button>} />
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Extra large dialog</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            The <code>xl</code> size takes up to 80% of the viewport width and is 80vh tall — useful
            for content-heavy views like previews, diffs, or browsers.
          </p>
          {Array.from({ length: 24 }, (_, i) => (
            <p key={i} className={cx(sx({ color: 'foregroundMuted' }))}>
              {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </p>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const ScrollableBody: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost">Open long dialog</Button>} />
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Terms of service</DialogTitle>
        </DialogHeader>
        <DialogBody maxHeight="50vh">
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i} className={cx(sx({ color: 'foregroundMuted' }))}>
              {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
              tempor incididunt ut labore et dolore magna aliqua.
            </p>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Decline</Button>} />
          <DialogClose render={<Button variant="primary">Accept</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
