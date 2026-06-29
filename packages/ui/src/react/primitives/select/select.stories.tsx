import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../box';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '.';
import * as s from '@react/story-layout.css';

const meta: Meta = {
  title: 'Primitives/Select',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Box className={s.w48}>
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="cherry">Cherry</SelectItem>
        </SelectContent>
      </Select>
    </Box>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <Box className={s.w48}>
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a food" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Fruits</SelectLabel>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Vegetables</SelectLabel>
            <SelectItem value="carrot">Carrot</SelectItem>
            <SelectItem value="pea">Pea</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Box>
  ),
};

export const WithDefaultValue: Story = {
  render: () => (
    <Box className={s.w48}>
      <Select defaultValue="banana">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="cherry">Cherry</SelectItem>
        </SelectContent>
      </Select>
    </Box>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Box className={s.w48}>
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Disabled" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>
    </Box>
  ),
};

export const WithDisabledItem: Story = {
  render: () => (
    <Box className={s.w48}>
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana" disabled>
            Banana (unavailable)
          </SelectItem>
          <SelectItem value="cherry">Cherry</SelectItem>
        </SelectContent>
      </Select>
    </Box>
  ),
};
