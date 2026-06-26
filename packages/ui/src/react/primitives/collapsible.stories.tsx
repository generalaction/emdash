import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Box } from './box';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from './collapsible';
import { SeparatedList } from './separated-list';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Primitives/Collapsible',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

// ── Default (uncontrolled, closed) ────────────────────────────────────────────

export const Default: Story = {
  render: () => (
    <Collapsible className={s.w72}>
      <CollapsibleTrigger>Advanced settings</CollapsibleTrigger>
      <CollapsiblePanel>
        <Box display="flex" flexDirection="column" gap="2" style={{ paddingTop: '0.5rem' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--foreground-muted)' }}>
            These settings are hidden by default.
          </span>
          <span style={{ fontSize: 'var(--text-sm)' }}>Setting A: enabled</span>
          <span style={{ fontSize: 'var(--text-sm)' }}>Setting B: disabled</span>
        </Box>
      </CollapsiblePanel>
    </Collapsible>
  ),
};

// ── Default open ──────────────────────────────────────────────────────────────

export const DefaultOpen: Story = {
  render: () => (
    <Collapsible defaultOpen className={s.w72}>
      <CollapsibleTrigger>Session details</CollapsibleTrigger>
      <CollapsiblePanel>
        <Box display="flex" flexDirection="column" gap="2" style={{ paddingTop: '0.5rem' }}>
          <span style={{ fontSize: 'var(--text-sm)' }}>Branch: feature/my-feature</span>
          <span style={{ fontSize: 'var(--text-sm)' }}>Worktree: /tmp/my-feature</span>
          <span style={{ fontSize: 'var(--text-sm)' }}>Agent: Claude</span>
        </Box>
      </CollapsiblePanel>
    </Collapsible>
  ),
};

// ── Controlled ────────────────────────────────────────────────────────────────

export const Controlled: Story = {
  render: function ControlledCollapsible() {
    const [open, setOpen] = useState(false);
    return (
      <Box display="flex" flexDirection="column" gap="3" className={s.w72}>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--foreground-muted)',
          }}
        >
          Panel is {open ? 'open' : 'closed'}
        </span>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger>Toggle panel</CollapsibleTrigger>
          <CollapsiblePanel>
            <Box style={{ paddingTop: '0.5rem' }}>
              <span style={{ fontSize: 'var(--text-sm)' }}>Controlled content revealed.</span>
            </Box>
          </CollapsiblePanel>
        </Collapsible>
      </Box>
    );
  },
};

// ── Disabled ──────────────────────────────────────────────────────────────────

export const Disabled: Story = {
  render: () => (
    <Collapsible disabled className={s.w72}>
      <CollapsibleTrigger>Locked section</CollapsibleTrigger>
      <CollapsiblePanel>
        <span style={{ fontSize: 'var(--text-sm)' }}>Never shown.</span>
      </CollapsiblePanel>
    </Collapsible>
  ),
};

// ── Nested / settings panel ───────────────────────────────────────────────────

export const SettingsGroup: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="0" className={s.w80}>
      <Collapsible defaultOpen>
        <CollapsibleTrigger>General</CollapsibleTrigger>
        <CollapsiblePanel>
          <SeparatedList
            gap="0.5rem"
            style={{ paddingTop: '0.25rem', paddingBottom: '0.25rem', paddingLeft: '0.5rem' }}
          >
            <span style={{ fontSize: 'var(--text-sm)' }}>Display name</span>
            <span style={{ fontSize: 'var(--text-sm)' }}>Theme</span>
            <span style={{ fontSize: 'var(--text-sm)' }}>Language</span>
          </SeparatedList>
        </CollapsiblePanel>
      </Collapsible>
      <Collapsible>
        <CollapsibleTrigger>SSH &amp; Connections</CollapsibleTrigger>
        <CollapsiblePanel>
          <SeparatedList
            gap="0.5rem"
            style={{ paddingTop: '0.25rem', paddingBottom: '0.25rem', paddingLeft: '0.5rem' }}
          >
            <span style={{ fontSize: 'var(--text-sm)' }}>Default SSH key</span>
            <span style={{ fontSize: 'var(--text-sm)' }}>Timeout</span>
          </SeparatedList>
        </CollapsiblePanel>
      </Collapsible>
      <Collapsible>
        <CollapsibleTrigger>Telemetry</CollapsibleTrigger>
        <CollapsiblePanel>
          <Box style={{ padding: '0.5rem' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--foreground-muted)' }}>
              No telemetry settings configured.
            </span>
          </Box>
        </CollapsiblePanel>
      </Collapsible>
    </Box>
  ),
};
