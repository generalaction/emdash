import { Button } from '@emdash/ui/react';
import { Check, GitBranch, LogOut, Radio, Smartphone } from 'lucide-react';
import type { Catalog, TaskSummary } from '../client/types';
import { isTaskSelectable, tasksForProject } from '../model';
import { BottomSheet } from './bottom-sheet';

export function TaskPicker({
  open,
  catalog,
  activeTaskId,
  deviceName,
  onSelect,
  onLogout,
  onClose,
}: {
  open: boolean;
  catalog: Catalog;
  activeTaskId: string;
  deviceName?: string;
  onSelect: (task: TaskSummary) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      title="Projects & tasks"
      description="Choose what to work on from this phone."
      onClose={onClose}
    >
      <div className="task-picker-list">
        {catalog.projects.map((project) => (
          <section className="project-group" key={project.id}>
            <header>
              <span>{project.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <h3>{project.name}</h3>
                {project.repository && <p>{project.repository}</p>}
              </div>
            </header>
            <div className="project-tasks">
              {tasksForProject(catalog.tasks, project.id).map((task) => {
                const selected = task.id === activeTaskId;
                return (
                  <button
                    type="button"
                    key={task.id}
                    className="task-option"
                    data-selected={selected || undefined}
                    disabled={!isTaskSelectable(task)}
                    onClick={() => onSelect(task)}
                  >
                    <span className="task-state">
                      {task.status === 'provisioning' ? (
                        <span className="spinner small" />
                      ) : task.status === 'unavailable' ? (
                        <Radio size={15} />
                      ) : (
                        <GitBranch size={15} />
                      )}
                    </span>
                    <span className="task-option-copy">
                      <strong>{task.name}</strong>
                      <span>
                        {task.statusMessage ??
                          (task.status === 'dormant'
                            ? 'Starts when opened'
                            : (task.branch ?? 'Ready'))}
                      </span>
                    </span>
                    {selected && <Check size={18} className="selected-check" />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <footer className="device-footer">
        <div>
          <span className="device-icon">
            <Smartphone size={16} />
          </span>
          <span>
            <strong>{deviceName ?? 'Paired phone'}</strong>
            <small>Authorized until Emdash restarts</small>
          </span>
        </div>
        <Button type="button" variant="ghost" tone="destructive" size="sm" onClick={onLogout}>
          <LogOut size={15} /> Disconnect
        </Button>
      </footer>
    </BottomSheet>
  );
}
