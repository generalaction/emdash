import { useState, useEffect, useCallback, useRef } from 'react';
import type { SshConnection, SshConnectionConfig } from '../components/ssh';
import type { ConnectionState, SshConfigHost } from '../../shared/ssh/types';

export interface UseSshConnectionsResult {
  connections: SshConnection[];
  isLoading: boolean;
  error: Error | null;
  createConnection: (name: string, config: SshConnectionConfig) => Promise<SshConnection>;
  updateConnection: (id: string, updates: Partial<SshConnection>) => Promise<SshConnection>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<{ success: boolean; message?: string }>;
  refresh: () => Promise<void>;
  getConnectionState: (id: string) => ConnectionState;
  getSshConfigHost: (hostAlias: string) => Promise<SshConfigHost | null>;
}

// Cache for connection states to avoid flickering
const stateCache = new Map<string, ConnectionState>();

export function useSshConnections(): UseSshConnectionsResult {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [connectionStates, setConnectionStates] = useState<Map<string, ConnectionState>>(
    () => new Map(stateCache)
  );
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch all connections
  const fetchConnections = useCallback(async () => {
    try {
      // The API returns an array directly, not wrapped in { success, connections }
      const result = (await window.electronAPI.sshGetConnections()) as unknown as SshConnection[];
      if (Array.isArray(result)) {
        // Merge with cached states
        const mergedConnections = result.map((conn: SshConnection) => ({
          ...conn,
          state: stateCache.get(conn.id) || 'disconnected',
        }));
        setConnections(mergedConnections);
      }
    } catch (err) {
      console.error('Failed to fetch SSH connections:', err);
      throw err;
    }
  }, []);

  // Refresh function
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await fetchConnections();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch connections'));
    } finally {
      setIsLoading(false);
    }
  }, [fetchConnections]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll connection states periodically
  useEffect(() => {
    const pollStates = async () => {
      if (connections.length === 0) return;

      const newStates = new Map(connectionStates);
      let hasChanges = false;

      for (const conn of connections) {
        try {
          // The API returns the state string directly
          const state = (await window.electronAPI.sshGetState(conn.id)) as ConnectionState;
          if (state && stateCache.get(conn.id) !== state) {
            stateCache.set(conn.id, state);
            newStates.set(conn.id, state);
            hasChanges = true;
          }
        } catch (err) {
          // Silently ignore state fetch errors
          console.warn(`Failed to get state for connection ${conn.id}:`, err);
        }
      }

      if (hasChanges) {
        setConnectionStates(newStates);
        // Update connections with new states
        setConnections((prev) =>
          prev.map((conn) => ({
            ...conn,
            state: newStates.get(conn.id) || conn.state,
          }))
        );
      }
    };

    // Poll immediately
    pollStates();

    // Set up interval
    refreshIntervalRef.current = setInterval(pollStates, 5000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [connections.length]);

  // Create a new connection
  const createConnection = useCallback(
    async (name: string, config: SshConnectionConfig): Promise<SshConnection> => {
      setIsLoading(true);
      setError(null);
      try {
        const saveConfig = {
          ...config,
          name,
        };
        // The API returns the connection directly, not wrapped in { success, connection }
        const result = (await window.electronAPI.sshSaveConnection(
          saveConfig
        )) as unknown as SshConnection;

        if (result && result.id) {
          await fetchConnections(); // Refresh the list
          return result;
        } else {
          throw new Error('Failed to save connection');
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to create connection');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchConnections]
  );

  // Update an existing connection
  const updateConnection = useCallback(
    async (id: string, updates: Partial<SshConnection>): Promise<SshConnection> => {
      setIsLoading(true);
      setError(null);
      try {
        // Find the existing connection
        const existing = connections.find((c) => c.id === id);
        if (!existing) {
          throw new Error('Connection not found');
        }

        // Merge updates
        const updated = {
          ...existing,
          ...updates,
        };

        // The API returns the connection directly
        const result = (await window.electronAPI.sshSaveConnection(
          updated
        )) as unknown as SshConnection;

        if (result && result.id) {
          await fetchConnections(); // Refresh the list
          return result;
        } else {
          throw new Error('Failed to update connection');
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to update connection');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [connections, fetchConnections]
  );

  // Delete a connection
  const deleteConnection = useCallback(
    async (id: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        await window.electronAPI.sshDeleteConnection(id);

        // Remove from cache
        stateCache.delete(id);
        setConnectionStates((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        await fetchConnections(); // Refresh the list
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to delete connection');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchConnections]
  );

  // Test a connection
  const testConnection = useCallback(
    async (id: string): Promise<{ success: boolean; message?: string }> => {
      try {
        const connection = connections.find((c) => c.id === id);
        if (!connection) {
          return { success: false, message: 'Connection not found' };
        }

        // Get full connection details for testing
        const testConfig = {
          id: connection.id,
          name: connection.name,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          authType: connection.authType,
          privateKeyPath: connection.privateKeyPath,
          useAgent: connection.useAgent,
          // For sshConfig auth, the host field stores the config alias
          sshConfigHost: connection.authType === 'sshConfig' ? connection.host : undefined,
        };

        // sshTestConnection returns { success, error?, latency? }
        const result = (await window.electronAPI.sshTestConnection(testConfig)) as {
          success: boolean;
          error?: string;
        };

        return {
          success: result.success,
          message: result.error || (result.success ? 'Connection successful' : 'Connection failed'),
        };
      } catch (err) {
        return {
          success: false,
          message: err instanceof Error ? err.message : 'Test failed',
        };
      }
    },
    [connections]
  );

  // Get connection state
  const getConnectionState = useCallback(
    (id: string): ConnectionState => {
      return connectionStates.get(id) || stateCache.get(id) || 'disconnected';
    },
    [connectionStates]
  );

  // Get SSH config host by alias
  const getSshConfigHost = useCallback(async (hostAlias: string): Promise<SshConfigHost | null> => {
    try {
      if (!hostAlias || typeof hostAlias !== 'string') {
        return null;
      }

      const result = (await window.electronAPI.sshGetSshConfigHost(hostAlias)) as {
        success: boolean;
        host?: SshConfigHost;
        error?: string;
      };

      if (result.success && result.host) {
        return result.host;
      }
      return null;
    } catch (err) {
      console.warn(`Failed to get SSH config host ${hostAlias}:`, err);
      return null;
    }
  }, []);

  return {
    connections,
    isLoading,
    error,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    refresh,
    getConnectionState,
    getSshConfigHost,
  };
}
