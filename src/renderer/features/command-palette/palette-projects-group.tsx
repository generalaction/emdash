import { Command } from 'cmdk';
import { FolderOpen } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { PALETTE_ITEM_CLASS } from './palette-item-styles';

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

interface PaletteProjectsGroupProps {
  /** When set, this project is excluded from the list (project scope). Undefined shows all (app scope). */
  currentProjectId: string | undefined;
  limit?: number;
  onClose: () => void;
  navigate: NavigateFnTyped;
}

export function PaletteProjectsGroup({
  currentProjectId,
  limit,
  onClose,
  navigate,
}: PaletteProjectsGroupProps) {
  const projects = useObserver(() => {
    const result: Array<{ id: string; name: string }> = [];
    for (const store of getProjectManagerStore().projects.values()) {
      const mounted = asMounted(store);
      if (!mounted) continue;
      if (mounted.data.id === currentProjectId) continue;
      result.push({ id: mounted.data.id, name: store.name ?? mounted.data.id });
    }
    return result;
  });

  const visible = limit !== undefined ? projects.slice(0, limit) : projects;

  if (visible.length === 0) return null;

  return (
    <Command.Group heading="Projects" className={GROUP_CLASS}>
      {visible.map((p) => (
        <Command.Item
          key={p.id}
          value={`project:${p.id}`}
          onSelect={() => {
            navigate('project', { projectId: p.id });
            onClose();
          }}
          className={PALETTE_ITEM_CLASS}
        >
          <FolderOpen size={14} className="shrink-0 text-foreground/40" />
          <span className="flex-1 truncate">{p.name}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}
