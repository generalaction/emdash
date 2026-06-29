import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Box } from '@react/primitives/box';
import { Switch } from '@react/primitives/switch';
import * as s from '@react/story-layout.css';

const meta: Meta = {
  title: 'Primitives/Switch',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Switch aria-label="Enable feature" />,
};

export const Controlled: Story = {
  render: function ControlledSwitch() {
    const [checked, setChecked] = useState(false);
    return (
      <Box display="flex" alignItems="center" gap="2">
        <Switch checked={checked} onCheckedChange={setChecked} aria-label="Telemetry" />
        <span style={{ fontSize: 'var(--text-sm)' }}>{checked ? 'On' : 'Off'}</span>
      </Box>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" className={s.w72}>
      <Switch disabled aria-label="Disabled off" />
      <Switch disabled defaultChecked aria-label="Disabled on" />
    </Box>
  ),
};

export const InFormRow: Story = {
  render: () => (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      gap="4"
      className={s.w72}
    >
      <Box display="flex" flexDirection="column" gap="1">
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Send telemetry</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--foreground-muted)' }}>
          Anonymous usage data helps us improve.
        </span>
      </Box>
      <Switch defaultChecked aria-label="Send telemetry" />
    </Box>
  ),
};
