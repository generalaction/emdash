import { List, ActionPanel, Action } from '@raycast/api';
import { useState, useEffect } from 'react';
import { emdashApi } from './lib/api';
import type { SshConnection } from './lib/types';

export default function SshConnections() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    emdashApi
      .getSshConnections()
      .then((data) => {
        setConnections(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  return (
    <List isLoading={loading}>
      {connections.map((conn) => (
        <List.Item
          key={conn.id}
          title={conn.name}
          subtitle={`${conn.username}@${conn.host}:${conn.port}`}
          actions={
            <ActionPanel>
              <Action title="Connect" onAction={() => open(`emdash://ssh?connection=${conn.id}`)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
