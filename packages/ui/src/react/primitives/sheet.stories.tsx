/**
 * Sheet — side-panel primitive composed of Header / Body / Footer.
 *
 * Stories demonstrate:
 *  - Default composition (right side: header + body + footer)
 *  - Left side variant
 *  - Scrollable long body with top scroll-fade
 *  - Sheet without a footer (header + body only)
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Button } from './button';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';

const meta: Meta = {
  title: 'Primitives/Sheet',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

// ── Default (right side) ──────────────────────────────────────────────────────

export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sheet title</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="text-foreground-muted">
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

// ── Left side ─────────────────────────────────────────────────────────────────

export const LeftSide: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open left sheet</Button>} />
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="text-foreground-muted">
            This sheet slides in from the left. Use it for navigation drawers, sidebars, or
            secondary panels.
          </p>
          <div className="mt-4 flex flex-col gap-1">
            {['Overview', 'Tasks', 'Settings', 'Members', 'Integrations'].map((item) => (
              <button
                key={item}
                type="button"
                className="hover:bg-surface-base-emphasis rounded-lg px-3 py-2 text-left text-sm text-foreground"
              >
                {item}
              </button>
            ))}
          </div>
        </SheetBody>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost">Close</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

// ── Scrollable body ───────────────────────────────────────────────────────────

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
            <p key={i} className="text-foreground-muted">
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

// ── Without footer ────────────────────────────────────────────────────────────

export const WithoutFooter: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost">Open detail sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Details</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="text-foreground-muted">
            This sheet has no footer — the close button in the header is the only dismiss
            affordance. Useful for detail panels, previews, or read-only views.
          </p>
          <div
            className="mt-4 rounded-lg border border-border p-3 text-xs"
            style={{ color: 'var(--foreground-muted)' }}
          >
            <p className="font-medium text-foreground">Component</p>
            <p>packages/ui/src/primitives/sheet.tsx</p>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};
