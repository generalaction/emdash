import { List, ActionPanel, Action, open } from '@raycast/api';
import { useState, useEffect } from 'react';
import { emdashApi } from './lib/api';
import type { Project } from './lib/types';

export default function RecentProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    emdashApi
      .getRecentProjects()
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  return (
    <List isLoading={loading}>
      {projects.map((project) => (
        <List.Item
          key={project.id}
          title={project.name}
          subtitle={project.path}
          actions={
            <ActionPanel>
              <Action
                title="Open in Emdash"
                onAction={() => open(`emdash://open?project=${encodeURIComponent(project.path)}`)}
              />
              <Action title="Show in Finder" onAction={() => open(project.path)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
