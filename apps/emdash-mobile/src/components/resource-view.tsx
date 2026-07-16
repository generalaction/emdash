import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { ResourceHandle } from '../client/types';
import { BrowserView, DiffView, FileView } from './read-only-views';

const AcpView = lazy(() => import('./acp-view').then((module) => ({ default: module.AcpView })));
const TerminalView = lazy(() =>
  import('./terminal-view').then((module) => ({ default: module.TerminalView }))
);

export function ResourceView({
  handle,
  onBack,
  onRename,
}: {
  handle: ResourceHandle;
  onBack: () => void;
  onRename: () => void;
}) {
  const renamable =
    handle.kind === 'acp' || handle.kind === 'agent-terminal' || handle.kind === 'terminal';
  return (
    <main className="resource-detail">
      <header className="detail-header">
        <button
          type="button"
          className="icon-button"
          onClick={onBack}
          aria-label="Back to resources"
        >
          <ArrowLeft size={21} />
        </button>
        <div>
          <h1>{handle.summary.title}</h1>
          <p>
            {handle.kind === 'acp'
              ? 'Agent chat'
              : handle.kind === 'agent-terminal'
                ? 'Agent terminal'
                : handle.kind === 'terminal'
                  ? 'Shell terminal'
                  : handle.kind === 'diff'
                    ? handle.path
                    : handle.kind === 'file'
                      ? handle.path
                      : 'Browser link'}
          </p>
        </div>
        {renamable ? (
          <button type="button" className="icon-button" onClick={onRename} aria-label="Rename">
            <MoreHorizontal size={21} />
          </button>
        ) : (
          <span className="header-spacer" />
        )}
      </header>
      <div className="detail-content">
        <Suspense
          fallback={
            <div className="detail-loading" role="status">
              <span className="spinner" /> Loading session…
            </div>
          }
        >
          {handle.kind === 'acp' && <AcpView handle={handle} />}
          {(handle.kind === 'agent-terminal' || handle.kind === 'terminal') && (
            <TerminalView handle={handle} />
          )}
        </Suspense>
        {handle.kind === 'file' && <FileView handle={handle} />}
        {handle.kind === 'diff' && <DiffView handle={handle} />}
        {handle.kind === 'browser' && <BrowserView handle={handle} />}
      </div>
    </main>
  );
}
