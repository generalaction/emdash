import { List, ActionPanel, Action, open, showToast } from '@raycast/api';
import { useState, useEffect } from 'react';
import { emdashApi } from './lib/api';
import type { Project } from './lib/types';

export default function SearchProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    emdashApi
      .getProjects()
      .then((data) => {
        console.log('Loaded projects:', data.length);
        setProjects(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load projects:', err);
        showToast({ title: 'Failed to load projects', message: String(err) });
        setLoading(false);
      });
  }, []);

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchText.toLowerCase()) ||
      p.path.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Search projects..."
      onSearchTextChange={setSearchText}
    >
      {filteredProjects.map((project) => (
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
