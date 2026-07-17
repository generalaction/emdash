import {
  Bot,
  ChevronRight,
  Code2,
  FileCode2,
  FileText,
  Folder,
  GitCompareArrows,
  Globe2,
  Image,
  MessageSquare,
  MoreHorizontal,
  Plus,
  TerminalSquare,
} from 'lucide-react';
import type { ResourceCategory, ResourceKind, ResourceSummary } from '../client/types';

function ResourceIcon({
  kind,
  title,
  directory,
}: {
  kind: ResourceKind;
  title: string;
  directory?: boolean;
}) {
  if (kind === 'acp') return <MessageSquare size={18} />;
  if (kind === 'agent-terminal') return <Bot size={18} />;
  if (kind === 'terminal') return <TerminalSquare size={18} />;
  if (kind === 'diff') return <GitCompareArrows size={18} />;
  if (kind === 'browser') return <Globe2 size={18} />;
  if (directory) return <Folder size={18} />;
  if (/\.(?:png|jpe?g|gif|webp)$/i.test(title)) return <Image size={18} />;
  if (/\.(?:md|txt)$/i.test(title)) return <FileText size={18} />;
  if (/\.(?:ts|tsx|js|jsx|css|json)$/i.test(title)) return <FileCode2 size={18} />;
  return <Code2 size={18} />;
}

function emptyCopy(category: ResourceCategory): { title: string; body: string } {
  switch (category) {
    case 'conversations':
      return {
        title: 'No conversations yet',
        body: 'Start an agent chat or terminal for this task.',
      };
    case 'terminals':
      return { title: 'No terminals yet', body: 'Start a shell without leaving your phone.' };
    case 'files':
      return { title: 'No files found', body: 'This workspace may still be provisioning.' };
    case 'changes':
      return {
        title: 'Working tree is clean',
        body: 'New changes will appear here automatically.',
      };
    case 'browser':
      return {
        title: 'No open browser tabs',
        body: 'Open a browser tab in the desktop task first.',
      };
  }
}

export function ResourceList({
  category,
  resources,
  loading,
  error,
  onOpen,
  onRename,
  onNew,
}: {
  category: ResourceCategory;
  resources: ResourceSummary[];
  loading: boolean;
  error?: string;
  onOpen: (resource: ResourceSummary) => void;
  onRename: (resource: ResourceSummary) => void;
  onNew: () => void;
}) {
  if (loading) {
    return (
      <div className="resource-skeletons" aria-label="Loading resources">
        {[0, 1, 2, 3].map((item) => (
          <div className="resource-skeleton" key={item}>
            <span />
            <div>
              <span />
              <span />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state error-state">
        <p className="eyebrow">Couldn’t load resources</p>
        <h2>Desktop didn’t respond</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (resources.length === 0) {
    const copy = emptyCopy(category);
    return (
      <div className="empty-state">
        <div className="empty-icon">
          {category === 'terminals' ? <TerminalSquare /> : <MessageSquare />}
        </div>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        {(category === 'conversations' || category === 'terminals') && (
          <button type="button" className="secondary-action" onClick={onNew}>
            <Plus size={17} /> New session
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="resource-list">
      {resources.map((resource) => {
        const renamable =
          resource.kind === 'acp' ||
          resource.kind === 'agent-terminal' ||
          resource.kind === 'terminal';
        return (
          <div className="resource-row" key={resource.id}>
            <button className="resource-main" type="button" onClick={() => onOpen(resource)}>
              <span className={`resource-icon kind-${resource.kind}`}>
                <ResourceIcon
                  kind={resource.kind}
                  title={resource.title}
                  directory={resource.directory}
                />
                {resource.status === 'working' && <span className="live-dot" />}
              </span>
              <span className="resource-copy">
                <span className="resource-title-line">
                  <strong>{resource.title}</strong>
                  {resource.badge && <span className="resource-badge">{resource.badge}</span>}
                </span>
                <span>{resource.subtitle ?? 'Ready'}</span>
              </span>
              {!renamable && <ChevronRight className="row-chevron" size={18} />}
            </button>
            {renamable && (
              <button
                className="row-menu"
                type="button"
                aria-label={`Rename ${resource.title}`}
                onClick={() => onRename(resource)}
              >
                <MoreHorizontal size={19} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
