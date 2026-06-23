import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchIcon, XIcon } from 'lucide-react';
import React from 'react';
import { Box } from './box';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from './input-group';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Primitives/InputGroup',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const WithLeadingIcon: Story = {
  render: () => (
    <Box className={s.w72}>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search…" />
      </InputGroup>
    </Box>
  ),
};

export const WithTrailingButton: Story = {
  render: () => (
    <Box className={s.w72}>
      <InputGroup>
        <InputGroupInput placeholder="Search…" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Box>
  ),
};

export const WithPrefixText: Story = {
  render: () => (
    <Box className={s.w72}>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="example.com" />
      </InputGroup>
    </Box>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <Box className={s.w72}>
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Note</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea placeholder="Write something…" rows={3} />
      </InputGroup>
    </Box>
  ),
};

export const Invalid: Story = {
  render: () => (
    <Box className={s.w72}>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search…" aria-invalid="true" />
      </InputGroup>
    </Box>
  ),
};
