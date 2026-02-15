import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { SshConnectionList, SshConnection } from './SshConnectionList';
import { SshConnectionForm, SshConnectionConfig } from './SshConnectionForm';
import { Plus, Server, ChevronLeft, KeyRound } from 'lucide-react';
import { useSshConnections } from '../../hooks/useSshConnections';

interface Props {
  onAddConnection?: () => void;
  onManageKeys?: () => void;
}

type ViewState = 'list' | 'create' | 'edit';

export const SshSettingsCard: React.FC<Props> = ({ onAddConnection, onManageKeys }) => {
  const {
    connections,
    isLoading,
    error,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    refresh,
  } = useSshConnections();

  const [viewState, setViewState] = useState<ViewState>('list');
  const [editingConnection, setEditingConnection] = useState<SshConnection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddNew = useCallback(() => {
    setEditingConnection(null);
    setViewState('create');
    onAddConnection?.();
    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('ssh_settings_opened');
    });
  }, [onAddConnection]);

  const handleEdit = useCallback((connection: SshConnection) => {
    setEditingConnection(connection);
    setViewState('edit');
  }, []);

  const handleCancel = useCallback(() => {
    setViewState('list');
    setEditingConnection(null);
  }, []);

  const handleSubmit = useCallback(
    async (config: SshConnectionConfig) => {
      setIsSubmitting(true);
      try {
        if (viewState === 'edit' && editingConnection) {
          await updateConnection(editingConnection.id, config);
        } else {
          await createConnection(config.name, config);
        }
        setViewState('list');
        setEditingConnection(null);
        await refresh();
      } catch (err) {
        console.error('Failed to save connection:', err);
        // Error handling is done in the hook
      } finally {
        setIsSubmitting(false);
      }
    },
    [viewState, editingConnection, createConnection, updateConnection, refresh]
  );

  const handleDelete = useCallback(
    async (connection: SshConnection) => {
      try {
        await deleteConnection(connection.id);
        await refresh();
      } catch (err) {
        console.error('Failed to delete connection:', err);
      }
    },
    [deleteConnection, refresh]
  );

  const handleTest = useCallback(
    async (connection: SshConnection) => {
      try {
        const result = await testConnection(connection.id);
        // Force refresh to get updated state
        await refresh();
        return result;
      } catch (err) {
        console.error('Failed to test connection:', err);
        return { success: false, message: 'Test failed' };
      }
    },
    [testConnection, refresh]
  );

  const getInitialValues = (): Partial<SshConnectionConfig> => {
    if (editingConnection) {
      return {
        name: editingConnection.name,
        host: editingConnection.host,
        port: editingConnection.port,
        username: editingConnection.username,
        authType: editingConnection.authType,
        // Password and passphrase are not returned for security reasons
        password: '',
        passphrase: '',
      };
    }
    return {
      port: 22,
      authType: 'password',
    };
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-5 w-5" />
            SSH Connections
          </CardTitle>
          <CardDescription className="text-xs">
            Manage connections to remote servers
          </CardDescription>
        </div>

        {viewState === 'list' ? (
          <div className="flex items-center gap-2">
            {onManageKeys && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onManageKeys}
                className="hidden sm:flex"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                Manage Keys
              </Button>
            )}
            <Button type="button" size="sm" onClick={handleAddNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add Connection
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error.message}
          </div>
        )}

        {viewState === 'list' ? (
          <SshConnectionList
            connections={connections.map((conn) => ({
              ...conn,
              createdAt: conn.createdAt || new Date(),
              updatedAt: conn.updatedAt || new Date(),
            }))}
            isLoading={isLoading}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onTest={handleTest}
            onAddNew={handleAddNew}
          />
        ) : (
          <div className="rounded-lg border border-border bg-muted/20 p-6">
            <h3 className="mb-4 text-sm font-medium">
              {viewState === 'edit' ? 'Edit Connection' : 'New SSH Connection'}
            </h3>
            <SshConnectionForm
              initialValues={getInitialValues()}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSubmitting={isSubmitting}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SshSettingsCard;
