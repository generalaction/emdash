import {
  Bot,
  ChevronDown,
  FileCode2,
  FolderUp,
  GitCompareArrows,
  Globe2,
  MessageSquare,
  Plus,
  Search,
  TerminalSquare,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStatus, useMobileClient } from './client/context';
import type {
  Catalog,
  ResourceCategory,
  ResourceHandle,
  ResourceSummary,
  TaskSummary,
} from './client/types';
import { BrandMark } from './components/brand-mark';
import { NewSessionSheet } from './components/new-session-sheet';
import { OfflineBanner } from './components/offline-banner';
import { RenameSheet } from './components/rename-sheet';
import { ResourceList } from './components/resource-list';
import { ResourceView } from './components/resource-view';
import { TaskPicker } from './components/task-picker';
import { categoryForKind, isTaskSelectable, projectForTask, resourceCategories } from './model';

function CategoryIcon({ category }: { category: ResourceCategory }) {
  if (category === 'conversations') return <MessageSquare size={16} />;
  if (category === 'terminals') return <TerminalSquare size={16} />;
  if (category === 'files') return <FileCode2 size={16} />;
  if (category === 'changes') return <GitCompareArrows size={16} />;
  return <Globe2 size={16} />;
}

export function MobileShell({
  initialCatalog,
  deviceName,
  onLogout,
}: {
  initialCatalog: Catalog;
  deviceName?: string;
  onLogout: () => Promise<void>;
}) {
  const client = useMobileClient();
  const connectionStatus = useConnectionStatus();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [activeTaskId, setActiveTaskId] = useState(
    initialCatalog.tasks.find((task) => task.status === 'ready')?.id ??
      initialCatalog.tasks.find((task) => task.status === 'dormant')?.id ??
      initialCatalog.tasks[0]?.id ??
      ''
  );
  const [category, setCategory] = useState<ResourceCategory>('conversations');
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [resourceLoading, setResourceLoading] = useState(true);
  const [resourceError, setResourceError] = useState('');
  const [query, setQuery] = useState('');
  const [filePath, setFilePath] = useState('');
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ResourceSummary>();
  const [handle, setHandle] = useState<ResourceHandle>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const handleRef = useRef<ResourceHandle | undefined>(undefined);
  const resourceNavigationRef = useRef({ activeTaskId, category, filePath });

  const task = catalog.tasks.find((candidate) => candidate.id === activeTaskId);
  const project = task ? projectForTask(catalog.projects, task) : undefined;

  const loadResources = useCallback(
    async (taskId: string, nextCategory: ResourceCategory, nextFilePath = '') => {
      setResourceLoading(true);
      setResourceError('');
      try {
        const next = await client.getResources(taskId, nextCategory, nextFilePath);
        setResources(next);
      } catch (reason) {
        setResourceError(reason instanceof Error ? reason.message : 'Could not load resources.');
      } finally {
        setResourceLoading(false);
      }
    },
    [client]
  );

  useEffect(() => {
    if (!activeTaskId) return;
    void loadResources(activeTaskId, category, category === 'files' ? filePath : '');
  }, [activeTaskId, category, filePath, loadResources]);

  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  useEffect(() => {
    resourceNavigationRef.current = { activeTaskId, category, filePath };
  }, [activeTaskId, category, filePath]);

  useEffect(() => {
    const unsubscribe = client.subscribe((event) => {
      if (event.type === 'catalog.changed') {
        setCatalog(event.catalog);
        const current = resourceNavigationRef.current;
        if (current.activeTaskId) {
          void loadResources(
            current.activeTaskId,
            current.category,
            current.category === 'files' ? current.filePath : ''
          );
        }
      }
      if (
        event.type === 'resource.changed' &&
        event.handle.handleId === handleRef.current?.handleId
      ) {
        setHandle(event.handle);
      }
      if (event.type === 'resource.renamed') {
        setResources((current) =>
          current.map((resource) =>
            resource.id === event.resourceId ? { ...resource, title: event.title } : resource
          )
        );
        setHandle((current) =>
          current?.summary.id === event.resourceId
            ? { ...current, summary: { ...current.summary, title: event.title } }
            : current
        );
      }
    });
    return () => {
      unsubscribe();
      const current = handleRef.current;
      if (current) void client.closeResource(current.handleId);
    };
  }, [client, loadResources]);

  const filteredResources = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return resources;
    return resources.filter(
      (resource) =>
        resource.title.toLowerCase().includes(normalized) ||
        resource.subtitle?.toLowerCase().includes(normalized)
    );
  }, [query, resources]);

  const openResource = async (resource: ResourceSummary) => {
    if (resource.kind === 'file' && resource.directory) {
      setFilePath(resource.path ?? '');
      setQuery('');
      return;
    }
    setOpening(true);
    setOpenError('');
    try {
      const previous = handleRef.current;
      if (previous) await client.closeResource(previous.handleId);
      const next = await client.openResource(resource.id);
      setHandle(next);
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : 'Could not open this resource.');
    } finally {
      setOpening(false);
    }
  };

  const closeResource = async () => {
    const current = handleRef.current;
    setHandle(undefined);
    if (current) await client.closeResource(current.handleId);
  };

  const selectTask = (nextTask: TaskSummary) => {
    if (!isTaskSelectable(nextTask)) return;
    void closeResource();
    setActiveTaskId(nextTask.id);
    setCategory('conversations');
    setFilePath('');
    setQuery('');
    setTaskPickerOpen(false);
  };

  const created = (resource: ResourceSummary) => {
    const nextCategory = categoryForKind(resource.kind);
    setCategory(nextCategory);
    setResources((current) =>
      nextCategory === category
        ? [resource, ...current.filter((item) => item.id !== resource.id)]
        : current
    );
    void openResource(resource);
  };

  if (!task) {
    return (
      <main className="fatal-state">
        <BrandMark size={44} />
        <h1>No tasks available</h1>
        <p>Open a project on the desktop, then reconnect this phone.</p>
      </main>
    );
  }

  if (handle) {
    return (
      <>
        <OfflineBanner status={connectionStatus} onReconnect={() => client.reconnect()} />
        <ResourceView
          handle={handle}
          onBack={() => void closeResource()}
          onRename={() => setRenameTarget(handle.summary)}
        />
        <RenameSheet
          resource={renameTarget}
          onClose={() => setRenameTarget(undefined)}
          onRenamed={(resource) => {
            setHandle((current) =>
              current
                ? { ...current, summary: { ...current.summary, title: resource.title } }
                : current
            );
          }}
        />
      </>
    );
  }

  return (
    <main className="mobile-shell">
      <OfflineBanner status={connectionStatus} onReconnect={() => client.reconnect()} />
      <header className="shell-header">
        <div className="shell-brand">
          <BrandMark />
          <span
            className="desktop-status"
            data-online={connectionStatus === 'online' || undefined}
          />
        </div>
        <button className="task-switcher" type="button" onClick={() => setTaskPickerOpen(true)}>
          <span>
            <small>{project?.name ?? 'Project'}</small>
            <strong>{task.name}</strong>
          </span>
          <ChevronDown size={18} />
        </button>
        <button
          className="new-button"
          type="button"
          onClick={() => setNewSessionOpen(true)}
          aria-label="New session"
        >
          <Plus size={21} />
        </button>
      </header>

      <section className="task-hero">
        <div>
          <span className="eyebrow">{task.branch ?? 'Workspace'}</span>
          <h1>{task.name}</h1>
        </div>
        <div className="agent-pulse">
          <Bot size={16} />
          {resources.filter((resource) => resource.status === 'working').length || 'Ready'}
        </div>
      </section>

      <nav className="category-tabs" aria-label="Task resources">
        {resourceCategories.map((item) => {
          const count = task.counts[item.id];
          return (
            <button
              type="button"
              key={item.id}
              data-active={category === item.id || undefined}
              aria-current={category === item.id ? 'page' : undefined}
              onClick={() => {
                setCategory(item.id);
                setFilePath('');
                setQuery('');
              }}
            >
              <CategoryIcon category={item.id} />
              <span>{item.label}</span>
              {count !== undefined && count > 0 && <small>{count}</small>}
            </button>
          );
        })}
      </nav>

      <section className="resource-section">
        {category === 'files' && filePath && (
          <button
            type="button"
            className="file-parent"
            onClick={() => {
              setFilePath(parentPath(filePath));
              setQuery('');
            }}
          >
            <FolderUp size={16} />
            <span>{filePath}</span>
          </button>
        )}
        <div className="resource-toolbar">
          <label className="resource-search">
            <Search size={16} />
            <input
              type="search"
              value={query}
              placeholder={`Search ${resourceCategories.find((item) => item.id === category)?.label.toLowerCase()}`}
              aria-label="Search resources"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span>{filteredResources.length}</span>
        </div>
        {openError && (
          <button className="inline-error" type="button" onClick={() => setOpenError('')}>
            {openError}
          </button>
        )}
        {opening && (
          <div className="opening-overlay" role="status">
            <span className="spinner" /> Opening session…
          </div>
        )}
        <ResourceList
          category={category}
          resources={filteredResources}
          loading={resourceLoading}
          error={resourceError}
          onOpen={(resource) => void openResource(resource)}
          onRename={setRenameTarget}
          onNew={() => setNewSessionOpen(true)}
        />
      </section>

      <TaskPicker
        open={taskPickerOpen}
        catalog={catalog}
        activeTaskId={task.id}
        deviceName={deviceName}
        onSelect={selectTask}
        onClose={() => setTaskPickerOpen(false)}
        onLogout={() => void onLogout()}
      />
      <NewSessionSheet
        open={newSessionOpen}
        task={task}
        initialKind={category === 'terminals' ? 'terminal' : 'acp'}
        onClose={() => setNewSessionOpen(false)}
        onCreated={created}
      />
      <RenameSheet
        resource={renameTarget}
        onClose={() => setRenameTarget(undefined)}
        onRenamed={(resource) =>
          setResources((current) =>
            current.map((item) => (item.id === resource.id ? resource : item))
          )
        }
      />
    </main>
  );
}

function parentPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}
