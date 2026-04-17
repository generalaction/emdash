import { List, ActionPanel, Action, open } from '@raycast/api';
import { useState, useEffect } from 'react';
import { emdashApi } from './lib/api';
import type { Task } from './lib/types';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    emdashApi
      .getTasks()
      .then((data) => {
        setTasks(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  return (
    <List isLoading={loading}>
      {tasks.map((task) => (
        <List.Item
          key={task.id}
          title={task.name}
          subtitle={`Status: ${task.status}`}
          actions={
            <ActionPanel>
              <Action title="Open Task" onAction={() => open(`emdash://open?task=${task.id}`)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
