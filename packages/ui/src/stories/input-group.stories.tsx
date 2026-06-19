import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchIcon, XIcon } from 'lucide-react';
import React from 'react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '../components/input-group';

const meta: Meta = {
  title: 'Components/InputGroup',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const WithLeadingIcon: Story = {
  render: () => (
    <div className="w-72">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search…" />
      </InputGroup>
    </div>
  ),
};

export const WithTrailingButton: Story = {
  render: () => (
    <div className="w-72">
      <InputGroup>
        <InputGroupInput placeholder="Search…" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" variant="ghost">
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

export const WithPrefixText: Story = {
  render: () => (
    <div className="w-72">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="example.com" />
      </InputGroup>
    </div>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <div className="w-72">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Note</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea placeholder="Write something…" rows={3} />
      </InputGroup>
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="w-72">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search…" aria-invalid="true" />
      </InputGroup>
    </div>
  ),
};
