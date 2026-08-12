import type { Commit, GitChange } from '@emdash/core/runtimes/git/api';
import { AbsoluteTime, Badge, Button, Dialog, Spinner } from '@emdash/ui/react/primitives';
import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileIcon } from '@core/features/editor/contributions/browser/file-icon';
import { splitPath } from '@core/features/tasks/api/browser/utils';
import { formatDiffLineCount } from '@core/primitives/formatting/browser/format-diff-line-count';
import { defineModal } from '@core/primitives/modals/react';
import { GitChangeStatusIcon } from '../changes-list-item';
import { commitFullMessage, copyCommitValue } from './commit-clipboard';
import { useCommitFiles } from './use-commit-files';

export interface CommitDetailsModalProps {
  commit: Commit;
  projectId: string;
  workspaceId: string;
}

/**
 * Read-only view of a single commit. The commit itself is already loaded by the
 * surrounding log query, so only the file list is fetched here.
 */
export function CommitDetailsModal({ commit, projectId, workspaceId }: CommitDetailsModalProps) {
  const filesQuery = useCommitFiles(projectId, workspaceId, commit.hash, true);
  const files = filesQuery.data ?? [];

  return (
    <>
      <Dialog.Header>
        <Dialog.Title className="font-sans text-base tracking-normal text-foreground normal-case">
          {commit.subject}
        </Dialog.Title>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-foreground-muted">
          <span className="font-medium">{commit.author}</span>
          {'·'}
          <AbsoluteTime value={commit.date} />
          {'·'}
          <span className="font-mono text-foreground-passive">{commit.hash.slice(0, 7)}</span>
          <Badge variant="soft" tone={commit.isPushed ? 'success' : 'neutral'}>
            {commit.isPushed ? 'Pushed' : 'Local only'}
          </Badge>
        </div>
      </Dialog.Header>

      <Dialog.Body className="space-y-4">
        <CommitMessageBody commit={commit} />
        <CommitMetadata commit={commit} />
        <CommitFilesSection
          files={files}
          isLoading={filesQuery.isLoading}
          isError={filesQuery.isError}
        />
      </Dialog.Body>

      <Dialog.Footer className="gap-2 sm:gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyCommitValue(commit.hash, 'Commit SHA')}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy SHA
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void copyCommitValue(commitFullMessage(commit), 'Commit message')}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy message
        </Button>
      </Dialog.Footer>
    </>
  );
}

function CommitMessageBody({ commit }: { commit: Commit }) {
  if (!commit.body) {
    return (
      <p className="text-xs text-foreground-passive">
        This commit has no message body beyond its subject.
      </p>
    );
  }

  return (
    <pre className="max-h-64 overflow-y-auto rounded-md bg-background-quaternary-1 px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap text-foreground">
      {commit.body}
    </pre>
  );
}

function CommitMetadata({ commit }: { commit: Commit }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
      <MetadataRow label="Author">
        <IdentityValue name={commit.author} email={commit.authorEmail} />
        {' · '}
        <AbsoluteTime value={commit.date} includeYear />
      </MetadataRow>
      {commit.committer && (
        <MetadataRow label="Committer">
          <IdentityValue name={commit.committer} email={commit.committerEmail} />
          {commit.committerDate !== undefined && (
            <>
              {' · '}
              <AbsoluteTime value={commit.committerDate} includeYear />
            </>
          )}
        </MetadataRow>
      )}
      <MetadataRow label="Commit">
        <span className="font-mono break-all select-text">{commit.hash}</span>
      </MetadataRow>
      <MetadataRow label={commit.parents.length === 1 ? 'Parent' : 'Parents'}>
        {commit.parents.length === 0 ? (
          <span className="text-foreground-passive">None (root commit)</span>
        ) : (
          <span className="font-mono break-all select-text">
            {commit.parents.map((parent) => parent.slice(0, 7)).join(', ')}
          </span>
        )}
      </MetadataRow>
      {commit.tags.length > 0 && (
        <MetadataRow label={commit.tags.length === 1 ? 'Tag' : 'Tags'}>
          <span className="flex flex-wrap gap-1">
            {commit.tags.map((tag) => (
              <Badge key={tag} variant="outline" tone="info">
                {tag}
              </Badge>
            ))}
          </span>
        </MetadataRow>
      )}
    </dl>
  );
}

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  );
}

function IdentityValue({ name, email }: { name: string; email?: string }) {
  return (
    <span className="break-all select-text">
      {name}
      {email ? ` <${email}>` : ''}
    </span>
  );
}

function CommitFilesSection({
  files,
  isLoading,
  isError,
}: {
  files: readonly GitChange[];
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-foreground-passive">
        <Spinner size="sm" />
        Loading files...
      </div>
    );
  }

  if (isError) {
    return <p className="py-2 text-xs text-foreground-passive">Unable to load changed files.</p>;
  }

  if (files.length === 0) {
    return <p className="py-2 text-xs text-foreground-passive">No file changes.</p>;
  }

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between text-xs text-foreground-muted">
        <span>
          {files.length} {files.length === 1 ? 'file changed' : 'files changed'}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          {additions > 0 && (
            <span className="text-foreground-diff-added">+{formatDiffLineCount(additions)}</span>
          )}
          {deletions > 0 && (
            <span className="text-foreground-diff-deleted">-{formatDiffLineCount(deletions)}</span>
          )}
        </span>
      </div>
      <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
        {files.map((file) => (
          <CommitFileRow key={file.path} file={file} />
        ))}
      </ul>
    </section>
  );
}

function CommitFileRow({ file }: { file: GitChange }) {
  const { filename, directory } = splitPath(file.path);

  return (
    <li className="flex h-7 items-center justify-between gap-2 px-2">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <FileIcon filename={filename} size={12} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="max-w-full shrink-0 truncate text-sm">{filename}</span>
          {directory && (
            <span className="min-w-0 shrink truncate text-xs text-foreground-muted">
              {directory}
            </span>
          )}
        </span>
      </span>
      <span
        className="flex shrink-0 items-center gap-1.5"
        aria-label={`${file.additions} lines added, ${file.deletions} lines removed`}
      >
        <span className="flex items-center gap-1 text-xs leading-none tabular-nums">
          {file.additions > 0 && (
            <span className="text-foreground-diff-added">
              +{formatDiffLineCount(file.additions)}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-foreground-diff-deleted">
              -{formatDiffLineCount(file.deletions)}
            </span>
          )}
        </span>
        <GitChangeStatusIcon status={file.status} />
      </span>
    </li>
  );
}

export const commitDetailsModal = defineModal<void>()({
  id: 'commitDetailsModal',
  component: CommitDetailsModal,
  size: 'lg',
});
