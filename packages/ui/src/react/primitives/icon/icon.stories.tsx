import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { Bot, ExternalLink, Settings, User } from 'lucide-react';
import * as React from 'react';
import { Icon, IconSlot, type IconSize, type StaticSvgComponent } from './index';

const meta = {
  title: 'Primitives/Icon',
  component: Icon,
  args: {
    source: Settings,
    size: 'md',
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const SIZES: IconSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

export const Sizes: Story = {
  render: () => (
    <div className={sx({ display: 'flex', alignItems: 'center', gap: tokens.space.step4 })}>
      {SIZES.map((size) => (
        <div
          key={size}
          className={sx({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space.step1_5,
            color: tokens.foreground.default,
            fontSize: 'xs',
          })}
        >
          <Icon source={Bot} size={size} />
          {size}
        </div>
      ))}
    </div>
  ),
};

const SOURCES = [
  ['settings', Settings],
  ['user', User],
  ['bot', Bot],
  ['external link', ExternalLink],
] as const satisfies ReadonlyArray<readonly [string, StaticSvgComponent]>;

export const StaticSources: Story = {
  render: () => (
    <div
      className={sx({
        display: 'grid',
        gap: tokens.space.step4,
        color: tokens.foreground.default,
      })}
    >
      {SOURCES.map(([label, source]) => (
        <div
          key={label}
          className={sx({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space.step2,
          })}
        >
          <Icon source={source} />
          <span className={sx({ fontSize: 'xs' })}>{label}</span>
        </div>
      ))}
    </div>
  ),
};

export const ColorInheritance: Story = {
  render: () => (
    <div className={sx({ display: 'flex', gap: tokens.space.step4 })}>
      <span className={sx({ color: tokens.foreground.muted })}>
        <Icon source={Settings} /> Muted parent
      </span>
      <span className={sx({ color: tokens.feedback.success.foreground })}>
        <Icon source={Settings} /> Success parent
      </span>
    </div>
  ),
};

export const ExplicitAccessibleLabel: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space.step2,
      })}
    >
      <Icon source={Settings} label="Settings" />
      <span>Inspect this icon in the accessibility tree.</span>
    </div>
  ),
};

export const OpaqueChildSlot: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space.step4,
      })}
    >
      {SIZES.map((size) => (
        <IconSlot key={size} size={size}>
          <svg width="48" height="32" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M8 12h8" stroke="currentColor" strokeWidth="2" />
          </svg>
        </IconSlot>
      ))}
    </div>
  ),
};
