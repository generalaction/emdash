import { Box } from '@react/primitives/box';
import { Button } from '@react/primitives/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '.';
import * as s from '@react/story-layout.css';

const meta: Meta = {
  title: 'Primitives/Alert',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

export const Statuses: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" className={s.w80}>
      <Alert status="info">
        <AlertTitle>New version available</AlertTitle>
        <AlertDescription>Restart the app to apply Emdash 1.4.0.</AlertDescription>
      </Alert>

      <Alert status="success">
        <AlertTitle>Changes saved</AlertTitle>
        <AlertDescription>Your settings have been updated successfully.</AlertDescription>
      </Alert>

      <Alert status="warning">
        <AlertTitle>SSH key expires soon</AlertTitle>
        <AlertDescription>
          Your key will expire in 3 days. Rotate it to avoid connection failures.
        </AlertDescription>
      </Alert>

      <Alert status="destructive">
        <AlertTitle>Connection failed</AlertTitle>
        <AlertDescription>Unable to reach the remote host. Check your SSH config.</AlertDescription>
      </Alert>
    </Box>
  ),
};

// ── Simple (no title) ─────────────────────────────────────────────────────────

export const Simple: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" className={s.w80}>
      <Alert status="info">Agent is running in the background.</Alert>
      <Alert status="warning">Unsaved changes will be lost.</Alert>
      <Alert status="destructive">Build failed with exit code 1.</Alert>
    </Box>
  ),
};

// ── Dismissible ───────────────────────────────────────────────────────────────

export const Dismissible: Story = {
  render: function DismissibleAlerts() {
    const [visible, setVisible] = useState({
      info: true,
      success: true,
      warning: true,
      destructive: true,
    });

    return (
      <Box display="flex" flexDirection="column" gap="3" className={s.w80}>
        {visible.info && (
          <Alert status="info" onDismiss={() => setVisible((v) => ({ ...v, info: false }))}>
            <AlertTitle>Update available</AlertTitle>
            <AlertDescription>Emdash 1.5.0 is ready to install.</AlertDescription>
          </Alert>
        )}
        {visible.success && (
          <Alert status="success" onDismiss={() => setVisible((v) => ({ ...v, success: false }))}>
            <AlertTitle>Deployment complete</AlertTitle>
            <AlertDescription>Your app is live at production.</AlertDescription>
          </Alert>
        )}
        {visible.warning && (
          <Alert status="warning" onDismiss={() => setVisible((v) => ({ ...v, warning: false }))}>
            <AlertTitle>Rate limit approaching</AlertTitle>
            <AlertDescription>80% of your API quota used this month.</AlertDescription>
          </Alert>
        )}
        {visible.destructive && (
          <Alert
            status="destructive"
            onDismiss={() => setVisible((v) => ({ ...v, destructive: false }))}
          >
            <AlertTitle>Task failed</AlertTitle>
            <AlertDescription>The agent exited with an unhandled error.</AlertDescription>
          </Alert>
        )}
        {Object.values(visible).every((v) => !v) && (
          <Box display="flex" flexDirection="column" gap="2" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--em-text-sm)', color: 'var(--em-foreground-muted)' }}>
              All alerts dismissed.
            </span>
            <Button
              variant="ghost"
              onClick={() =>
                setVisible({ info: true, success: true, warning: true, destructive: true })
              }
            >
              Reset
            </Button>
          </Box>
        )}
      </Box>
    );
  },
};

// ── No icon ───────────────────────────────────────────────────────────────────

export const NoIcon: Story = {
  render: () => (
    <Box display="flex" flexDirection="column" gap="3" className={s.w80}>
      <Alert status="info" icon={null}>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>This section requires admin access.</AlertDescription>
      </Alert>
      <Alert status="destructive" icon={null}>
        Build failed — check the logs below.
      </Alert>
    </Box>
  ),
};

// ── Custom icon ───────────────────────────────────────────────────────────────

import { RocketIcon } from 'lucide-react';

export const CustomIcon: Story = {
  render: () => (
    <Alert status="success" icon={<RocketIcon />} className={s.w80}>
      <AlertTitle>Agent launched</AlertTitle>
      <AlertDescription>Claude is now running on your branch.</AlertDescription>
    </Alert>
  ),
};
