import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sshConnectionEventChannel } from '@shared/events/sshEvents';
import type { ConnectionState, ConnectionTestResult, SshConfig } from '@shared/ssh';
import { events, rpc } from '@renderer/lib/ipc';

// ─── Query keys ──────────────────────────────────────────────────────────────

const SSH_CONNECTIONS_KEY = ['ssh:connections'] as const;
const SSH_CONNECTION_STATES_KEY = ['ssh:connectionStates'] as const;

// ─── Context ─────────────────────────────────────────────────────────────────

interface SshConnectionContextValue {
  /** All saved SSH connection configs (no secrets). */
  connections: SshConfig[];
  /** Live connection state per connection ID. */
  connectionStates: Record<string, ConnectionState>;
  isLoading: boolean;

  /** Create or update an SSH connection. */
  saveConnection: (
    config: Omit<SshConfig, 'id'> & { password?: string; passphrase?: string }
  ) => Promise<SshConfig>;
  /** Rename a connection without touching credentials or other fields. */
  renameConnection: (id: string, name: string) => Promise<void>;
  /** Delete a connection and disconnect if active. */
  deleteConnection: (id: string) => Promise<void>;
  /** Test an SSH connection without saving it. */
  testConnection: (
    config: SshConfig & { password?: string; passphrase?: string }
  ) => Promise<ConnectionTestResult>;
}

const SshConnectionContext = createContext<SshConnectionContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function SshConnectionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // ── Saved configs ─────────────────────────────────────────────────────────

  const { data: connections = [], isFetching: isFetchingConnections } = useQuery({
    queryKey: SSH_CONNECTIONS_KEY,
    queryFn: () => rpc.ssh.getConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // ── Initial connection state snapshot ─────────────────────────────────────

  const { data: stateSnapshot } = useQuery({
    queryKey: SSH_CONNECTION_STATES_KEY,
    queryFn: () => rpc.ssh.getConnectionState(),
    staleTime: 0,
  });

  // Live event-driven overrides layered on top of the snapshot.
  const [liveUpdates, setLiveUpdates] = useState<Record<string, ConnectionState>>({});

  const connectionStates = useMemo(
    () => ({ ...stateSnapshot, ...liveUpdates }),
    [stateSnapshot, liveUpdates]
  );

  // ── Live state updates via IPC events ─────────────────────────────────────

  useEffect(() => {
    const unsubscribe = events.on(sshConnectionEventChannel, (event) => {
      const { connectionId } = event;

      let nextState: ConnectionState;
      switch (event.type) {
        case 'connected':
        case 'reconnected':
          nextState = 'connected';
          break;
        case 'reconnecting':
          nextState = 'reconnecting';
          break;
        case 'disconnected':
        case 'reconnect-failed':
          nextState = 'disconnected';
          break;
        case 'error':
          nextState = 'error';
          break;
      }

      setLiveUpdates((prev) => ({ ...prev, [connectionId]: nextState }));
    });

    return unsubscribe;
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveConnectionMutation = useMutation({
    mutationFn: (config: Omit<SshConfig, 'id'> & { password?: string; passphrase?: string }) =>
      rpc.ssh.saveConnection(config),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SSH_CONNECTIONS_KEY }),
  });

  const renameConnectionMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => rpc.ssh.renameConnection(id, name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SSH_CONNECTIONS_KEY }),
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: (id: string) => rpc.ssh.deleteConnection(id),
    onSuccess: (_data, id) => {
      setLiveUpdates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: SSH_CONNECTIONS_KEY });
    },
  });

  const saveConnection = useCallback(
    (config: Omit<SshConfig, 'id'> & { password?: string; passphrase?: string }) =>
      saveConnectionMutation.mutateAsync(config),
    [saveConnectionMutation]
  );

  const renameConnection = useCallback(
    (id: string, name: string) => renameConnectionMutation.mutateAsync({ id, name }),
    [renameConnectionMutation]
  );

  const deleteConnection = useCallback(
    (id: string) => deleteConnectionMutation.mutateAsync(id),
    [deleteConnectionMutation]
  );

  const testConnection = useCallback(
    (config: SshConfig & { password?: string; passphrase?: string }) =>
      rpc.ssh.testConnection(config),
    []
  );

  const isLoading =
    isFetchingConnections ||
    saveConnectionMutation.isPending ||
    renameConnectionMutation.isPending ||
    deleteConnectionMutation.isPending;

  return (
    <SshConnectionContext.Provider
      value={{
        connections,
        connectionStates,
        isLoading,
        saveConnection,
        renameConnection,
        deleteConnection,
        testConnection,
      }}
    >
      {children}
    </SshConnectionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSshConnectionContext(): SshConnectionContextValue {
  const context = useContext(SshConnectionContext);
  if (!context) {
    throw new Error('useSshConnectionContext must be used within a SshConnectionProvider');
  }
  return context;
}
