import { Box } from '@react/primitives/box';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TriggerButton } from '.';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import * as s from '@react/story-layout.css';

const meta: Meta = {
  title: 'Primitives/TriggerButton',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

/** Bare TriggerButton — becomes "active" (surface-selected) while expanded. */
export const Bare: Story = {
  render: () => (
    <Box display="flex" flexWrap="wrap" alignItems="center" gap="3">
      <TriggerButton>Choose an option</TriggerButton>
      <TriggerButton size="sm">Small trigger</TriggerButton>
      <TriggerButton showChevron={false}>No chevron</TriggerButton>
    </Box>
  ),
};

/** Select using SelectTrigger (wraps TriggerButton internally). */
export const AsSelectTrigger: Story = {
  render: () => (
    <Select>
      <SelectTrigger className={s.w48}>
        <SelectValue placeholder="Pick an option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Alpha</SelectItem>
        <SelectItem value="b">Beta</SelectItem>
        <SelectItem value="c">Gamma</SelectItem>
      </SelectContent>
    </Select>
  ),
};

/** Dropdown using TriggerButton as the trigger face. */
export const AsDropdownTrigger: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<TriggerButton className={s.w48}>Actions</TriggerButton>} />
      <DropdownMenuContent>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** Active state across all surfaces. */
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
            <Select>
              <SelectTrigger className={s.w40}>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Alpha</SelectItem>
                <SelectItem value="b">Beta</SelectItem>
              </SelectContent>
            </Select>
          </Box>
        )
      )}
    </Box>
  ),
};
