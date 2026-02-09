import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Spinner } from '../ui/spinner';
import { cn } from '@/lib/utils';
import { Edit2, Trash2, Play, Server, Plus, Monitor, Globe } from 'lucide-react';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import type { ConnectionState } from './ConnectionStatusBadge';

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  privateKeyPath?: string;
  useAgent?: boolean;
  state?: ConnectionState;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Props {
  connections: SshConnection[];
  isLoading?: boolean;
  onEdit?: (connection: SshConnection) => void;
  onDelete?: (connection: SshConnection) => void;
  onTest?: (connection: SshConnection) => void;
  onSelect?: (connection: SshConnection) => void;
  selectedId?: string;
  onAddNew?: () => void;
}

export const SshConnectionList: React.FC<Props> = ({
  connections,
  isLoading = false,
  onEdit,
  onDelete,
  onTest,
  onSelect,
  selectedId,
  onAddNew,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleDelete = async (connection: SshConnection) => {
    if (!onDelete) return;

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${connection.name}"?`)) {
      return;
    }

    setDeletingId(connection.id);
    try {
      await onDelete(connection);
    } finally {
      setDeletingId(null);
    }
  };

  const handleTest = async (connection: SshConnection) => {
    if (!onTest) return;

    setTestingId(connection.id);
    try {
      await onTest(connection);
    } finally {
      setTestingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <div className="mb-4 rounded-full bg-muted p-4">
          <Monitor className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-sm font-medium">No SSH connections</h3>
        <p className="mb-4 max-w-xs text-xs text-muted-foreground">
          Add an SSH connection to connect to remote servers and manage projects remotely.
        </p>
        {onAddNew && (
          <Button type="button" variant="outline" size="sm" onClick={onAddNew}>
            <Plus className="mr-2 h-4 w-4" />
            Add Connection
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {connections.map((connection) => (
        <div
          key={connection.id}
          className={cn(
            'group relative rounded-lg border p-4 transition-all',
            selectedId === connection.id
              ? 'border-primary bg-primary/5'
              : 'border-border bg-background hover:border-border/80 hover:bg-muted/30',
            onSelect && 'cursor-pointer'
          )}
          onClick={() => onSelect?.(connection)}
        >
          <div className="flex items-start justify-between gap-4">
            {/* Left side: Icon and Info */}
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                {connection.authType === 'password' ? (
                  <Globe className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Server className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="truncate font-medium">{connection.name}</h4>
                  {connection.state && (
                    <ConnectionStatusBadge state={connection.state} showIcon={false} />
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">
                    {connection.username}@{connection.host}
                  </span>
                  <span>·</span>
                  <span>Port {connection.port}</span>
                </div>

                {connection.lastError && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {connection.lastError}
                  </p>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {connection.authType === 'password'
                      ? 'Password'
                      : connection.authType === 'key'
                        ? 'SSH Key'
                        : 'SSH Agent'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Right side: Actions */}
            <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
              {onTest && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTest(connection);
                  }}
                  disabled={testingId === connection.id}
                  title="Test connection"
                >
                  {testingId === connection.id ? (
                    <Spinner size="sm" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              )}

              {onEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(connection);
                  }}
                  title="Edit connection"
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              )}

              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-600 hover:text-red-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(connection);
                  }}
                  disabled={deletingId === connection.id}
                  title="Delete connection"
                >
                  {deletingId === connection.id ? (
                    <Spinner size="sm" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SshConnectionList;
