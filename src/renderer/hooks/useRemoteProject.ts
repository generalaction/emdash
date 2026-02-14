import { useState, useEffect, useCallback, useRef } from 'react';
import type { ConnectionState } from '../components/ssh';
import type { Project } from '../types/app';

export interface UseRemoteProjectResult {
  isRemote: boolean;
  connectionState: ConnectionState;
  connectionId: string | null;
  host: string | null;
  error: Error | null;
  isLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
}

// Connection state cache to persist across component unmounts
const connectionStateCache = new Map<string, ConnectionState>();
const connectionAttempts = new Map<string, number>();
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Module-level set of connection IDs that currently have an in-flight
 * connect() call. Prevents multiple hooks (or re-renders) from firing
 * parallel TCP connections for the same remote host.
 */
const connectingIds = new Set<string>();

export function useRemoteProject(project: Project | null): UseRemoteProjectResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>(() => {
    if (!project) return 'disconnected';
    // Check if this is a remote project
    const isRemote = (project as any).isRemote || (project as any).sshConnectionId;
    if (!isRemote) return 'disconnected';
    return connectionStateCache.get(project.id) || 'disconnected';
  });
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [host, setHost] = useState<string | null>(null);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Determine if this is a remote project
  const isRemote = Boolean(
    project && ((project as any).isRemote || (project as any).sshConnectionId)
  );
  const connectionId =
    project && (project as any).sshConnectionId ? (project as any).sshConnectionId : null;

  // Update connection state and cache
  const updateConnectionState = useCallback(
    (state: ConnectionState) => {
      if (project) {
        connectionStateCache.set(project.id, state);
      }
      setConnectionState(state);
    },
    [project]
  );

  // Connect to the remote project
  const connect = useCallback(async () => {
    if (!connectionId) return;

    // Deduplicate: skip if this connectionId already has an in-flight connect
    if (connectingIds.has(connectionId)) return;

    connectingIds.add(connectionId);
    setIsLoading(true);
    setError(null);
    updateConnectionState('connecting');

    try {
      // The API returns the connectionId string directly
      const result = await window.electronAPI.sshConnect(connectionId);

      if (!isMountedRef.current) return;

      // sshConnect returns the connectionId on success, throws on error
      if (result) {
        updateConnectionState('connected');
        connectionAttempts.set(connectionId, 0);
      } else {
        throw new Error('Connection failed');
      }
    } catch (err) {
      if (!isMountedRef.current) return;

      const error = err instanceof Error ? err : new Error('Connection failed');
      setError(error);
      updateConnectionState('error');
      console.error('Failed to connect to remote project:', error);
    } finally {
      connectingIds.delete(connectionId);
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [connectionId, updateConnectionState]);

  // Disconnect from the remote project
  const disconnect = useCallback(async () => {
    if (!connectionId) return;

    setIsLoading(true);
    try {
      await window.electronAPI.sshDisconnect(connectionId);
      if (isMountedRef.current) {
        updateConnectionState('disconnected');
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Failed to disconnect:', err);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [connectionId, updateConnectionState]);

  // Reconnect with retry logic
  const reconnect = useCallback(async () => {
    if (!connectionId) return;

    const attempts = connectionAttempts.get(connectionId) || 0;
    if (attempts >= MAX_RETRY_ATTEMPTS) {
      setError(
        new Error(`Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached. Please try again later.`)
      );
      return;
    }

    connectionAttempts.set(connectionId, attempts + 1);
    updateConnectionState('reconnecting');

    // Brief delay before reconnecting
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await connect();
  }, [connectionId, connect, updateConnectionState]);

  // Keep a ref to reconnect so the health-check effect can call it
  // without depending on it (avoids interval teardown/recreation loops).
  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;

  // Fetch connection details (host)
  useEffect(() => {
    if (!isRemote || !connectionId) {
      setHost(null);
      return;
    }

    const fetchConnectionDetails = async () => {
      try {
        // The API returns an array directly
        const result = (await window.electronAPI.sshGetConnections()) as Array<{
          id: string;
          host: string;
        }>;
        if (Array.isArray(result)) {
          const conn = result.find((c) => c.id === connectionId);
          if (conn) {
            setHost(conn.host);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch connection details:', err);
      }
    };

    fetchConnectionDetails();
  }, [isRemote, connectionId]);

  // Auto-connect on mount if this is a remote project
  useEffect(() => {
    isMountedRef.current = true;

    if (isRemote && connectionId && connectionState === 'disconnected') {
      // Small delay to allow UI to settle
      const timeout = setTimeout(() => {
        connect();
      }, 500);

      return () => {
        clearTimeout(timeout);
        isMountedRef.current = false;
      };
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [isRemote, connectionId, connect, connectionState]);

  // Health check - poll connection state
  // Note: `reconnect` is accessed via reconnectRef to avoid re-creating the
  // interval every time the callback identity changes.
  useEffect(() => {
    if (!isRemote || !connectionId) return;

    const checkHealth = async () => {
      try {
        // The API returns the state string directly
        const state = (await window.electronAPI.sshGetState(connectionId)) as ConnectionState;
        if (isMountedRef.current && state !== connectionState) {
          updateConnectionState(state);

          // Auto-reconnect if disconnected unexpectedly
          if (
            state === 'disconnected' &&
            connectionState === 'connected' &&
            !connectingIds.has(connectionId)
          ) {
            const attempts = connectionAttempts.get(connectionId) || 0;
            if (attempts < MAX_RETRY_ATTEMPTS) {
              reconnectRef.current();
            }
          }
        }
      } catch (err) {
        // Silently ignore health check errors
      }
    };

    // Check immediately if connected
    if (connectionState === 'connected') {
      checkHealth();
      healthCheckIntervalRef.current = setInterval(checkHealth, 10000); // Check every 10s when connected
    } else {
      healthCheckIntervalRef.current = setInterval(checkHealth, 5000); // Check every 5s otherwise
    }

    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, [isRemote, connectionId, connectionState, updateConnectionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't disconnect on unmount - let the service manage connections
      isMountedRef.current = false;
    };
  }, []);

  return {
    isRemote,
    connectionState,
    connectionId,
    host,
    error,
    isLoading,
    connect,
    disconnect,
    reconnect,
  };
}
