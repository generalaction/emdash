// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import WorkspaceProvisioningOverlay from '@/components/WorkspaceProvisioningOverlay';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('WorkspaceProvisioningOverlay', () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      workspaceCancel: vi.fn(),
      workspaceProviderCancelProvisioning: vi.fn(),
      workspaceStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { id: '123', status: 'provisioning' },
      }),
      onWorkspaceProvisionTimeoutWarning: vi.fn((cb) => {
        return () => {};
      }),
      onWorkspaceProvisionProgress: vi.fn(() => () => {}),
      onWorkspaceProvisionComplete: vi.fn(() => () => {}),
      onTerminalOutput: vi.fn(() => () => {}),
    };
  });

  const mockTask: any = {
    id: 1,
    runConfigStatus: 'provisioning',
    workspaceInstanceId: '123',
    metadata: { workspace: { provider: 'test' } },
  };
  const mockProject: any = { id: 1 };

  it('renders provisioning state but not warning initially', async () => {
    render(<WorkspaceProvisioningOverlay task={mockTask} project={mockProject} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Provisioning workspace/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Provisioning is taking longer than expected/i)).toBeNull();
  });

  it('renders warning when onWorkspaceProvisionTimeoutWarning triggers', async () => {
    let storedCb: any = null;
    (window as any).electronAPI.onWorkspaceProvisionTimeoutWarning = vi.fn((cb) => {
      storedCb = cb;
      return () => {};
    });

    render(<WorkspaceProvisioningOverlay task={mockTask} project={mockProject} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Provisioning workspace/i)).toBeTruthy();
    });

    // Wait for the workspaceStatus promise to resolve and ref to be populated
    await new Promise((r) => setTimeout(r, 50));

    // Trigger warning
    if (storedCb) storedCb({ instanceId: '123' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Keep Waiting/i })).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /^Cancel$/i }).length).toBeGreaterThan(0);
    });
  });

  it('dismisses warning when Keep Waiting is clicked', async () => {
    let storedCb: any = null;
    (window as any).electronAPI.onWorkspaceProvisionTimeoutWarning = vi.fn((cb) => {
      storedCb = cb;
      return () => {};
    });

    render(<WorkspaceProvisioningOverlay task={mockTask} project={mockProject} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Provisioning workspace/i)).toBeTruthy();
    });

    // Wait for the workspaceStatus promise to resolve
    await new Promise((r) => setTimeout(r, 50));

    if (storedCb) storedCb({ instanceId: '123' });

    const btn = await screen.findByRole('button', { name: /Keep Waiting/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /Keep Waiting/i }).length).toBe(0);
    });
  });

  it('calls workspaceCancel when Cancel is clicked', async () => {
    let storedCb: any = null;
    (window as any).electronAPI.onWorkspaceProvisionTimeoutWarning = vi.fn((cb) => {
      storedCb = cb;
      return () => {};
    });

    render(<WorkspaceProvisioningOverlay task={mockTask} project={mockProject} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Provisioning workspace/i)).toBeTruthy();
    });

    // Wait for the workspaceStatus promise to resolve
    await new Promise((r) => setTimeout(r, 50));

    if (storedCb) storedCb({ instanceId: '123' });

    await screen.findByRole('button', { name: /Keep Waiting/i });
    const btns = await screen.findAllByRole('button', { name: /^Cancel$/i });
    fireEvent.click(btns[btns.length - 1]); // click the last cancel button (the warning one)

    expect((window as any).electronAPI.workspaceCancel).toHaveBeenCalledWith({ instanceId: '123' });
  });
});
