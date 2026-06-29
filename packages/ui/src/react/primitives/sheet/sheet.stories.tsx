import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '@styles/utilities/cx';
import { Box } from '@react/primitives/box';
import { Button } from '@react/primitives/button';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@react/primitives/sheet';
import { sx } from '@styles/utilities/sprinkles.css';

const meta: Meta = {
  title: 'Primitives/Sheet',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sheet title</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This is the sheet body. Place forms, content, or any composition here. The body scrolls
            independently when it overflows, with a top fade when scrolled down.
          </p>
        </SheetBody>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost">Cancel</Button>} />
          <SheetClose render={<Button variant="primary">Save</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const LeftSide: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open left sheet</Button>} />
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This sheet slides in from the left. Use it for navigation drawers, sidebars, or
            secondary panels.
          </p>
          <Box marginTop="4" display="flex" flexDirection="column" gap="1">
            {['Overview', 'Tasks', 'Settings', 'Members', 'Integrations'].map((item) => (
              <button
                key={item}
                type="button"
                className={cx(
                  sx({
                    background: 'surfaceBaseEmphasis',
                    rounded: 'lg',
                    px: '3',
                    py: '2',
                    textAlign: 'left',
                    fontSize: 'sm',
                    color: 'foreground',
                  })
                )}
              >
                {item}
              </button>
            ))}
          </Box>
        </SheetBody>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost">Close</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const ScrollableBody: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open scrollable sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Changelog</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i} className={cx(sx({ color: 'foregroundMuted' }))}>
              {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
              tempor incididunt ut labore et dolore magna aliqua.
            </p>
          ))}
        </SheetBody>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost">Dismiss</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const WithoutFooter: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open detail sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Details</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className={cx(sx({ color: 'foregroundMuted' }))}>
            This sheet has no footer — the close button in the header is the only dismiss
            affordance. Useful for detail panels, previews, or read-only views.
          </p>
          <Box
            marginTop="4"
            rounded="lg"
            borderWidth="1"
            borderStyle="solid"
            borderColor="border"
            padding="3"
            fontSize="xs"
            style={{ color: 'var(--foreground-muted)' }}
          >
            <p className={cx(sx({ fontWeight: 'medium', color: 'foreground' }))}>Component</p>
            <p>packages/ui/src/primitives/sheet.tsx</p>
          </Box>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};
