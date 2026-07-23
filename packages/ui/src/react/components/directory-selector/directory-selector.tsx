import { cx } from '@styles/utilities/cx';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileIcon,
  FolderGit2Icon,
  FolderIcon,
  Link2Icon,
  Loader2Icon,
} from 'lucide-react';
import * as React from 'react';
import { Breadcrumbs, type BreadcrumbItem } from '../../primitives/breadcrumbs';
import { Button } from '../../primitives/button';
import { ScrollContainer } from '../../primitives/scroll-container';
import { SearchInput } from '../../primitives/search-input';
import * as styles from './directory-selector.css';

export interface DirectoryEntry {
  name: string;
  kind: 'directory' | 'repository' | 'file' | 'symlink';
}

export type DirectoryListing =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: DirectoryEntry[] };

export interface DirectorySelectorProps {
  path: string;
  listing: DirectoryListing;
  selectedPath?: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
  onNavigate(path: string): void;
  onSelect(path: string | null): void;
  separator?: '/' | '\\';
  className?: string;
}

export function DirectorySelector({
  path,
  listing,
  selectedPath,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  onSelect,
  separator = '/',
  className,
}: DirectorySelectorProps) {
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    setQuery('');
  }, [path]);

  const folderName = basename(path, separator);
  const filteredEntries =
    listing.status === 'ready'
      ? listing.entries.filter((entry) => matchesQuery(entry.name, query))
      : [];
  const breadcrumbs = React.useMemo(
    () => pathToBreadcrumbs(path, separator, onNavigate),
    [onNavigate, path, separator]
  );

  return (
    <section className={cx(styles.root, className)} aria-label="Directory selector">
      <header className={styles.header}>
        <div className={styles.navigationControls}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            disabled={!canGoBack}
            aria-label="Go back"
            onClick={onBack}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            disabled={!canGoForward}
            aria-label="Go forward"
            onClick={onForward}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
        <div className={styles.currentFolder} title={path}>
          {folderName}
        </div>
        <div className={styles.searchSlot}>
          <SearchInput
            size="sm"
            className={styles.searchInput}
            value={query}
            placeholder="Search"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onClear={() => setQuery('')}
          />
        </div>
      </header>

      <ScrollContainer maxHeight={320} topFade={false} viewportClassName={styles.list}>
        {listing.status === 'loading' ? (
          <DirectoryState>
            <Loader2Icon aria-hidden className={styles.spinner} />
            Loading folder
          </DirectoryState>
        ) : listing.status === 'error' ? (
          <DirectoryState error>{listing.message}</DirectoryState>
        ) : listing.entries.length === 0 ? (
          <DirectoryState>Empty folder</DirectoryState>
        ) : filteredEntries.length === 0 ? (
          <DirectoryState>No matches</DirectoryState>
        ) : (
          filteredEntries.map((entry) => {
            const entryPath = joinPath(path, entry.name, separator);
            const selectable = isSelectableEntry(entry);
            const selected = selectable && selectedPath === entryPath;
            return (
              <DirectoryRow
                key={`${entry.kind}:${entry.name}`}
                entry={entry}
                path={entryPath}
                selected={selected}
                selectable={selectable}
                onNavigate={onNavigate}
                onSelect={onSelect}
              />
            );
          })
        )}
      </ScrollContainer>

      <footer className={styles.footer}>
        <Breadcrumbs items={breadcrumbs} label="Current directory path" />
      </footer>
    </section>
  );
}

function DirectoryRow({
  entry,
  path,
  selected,
  selectable,
  onNavigate,
  onSelect,
}: {
  entry: DirectoryEntry;
  path: string;
  selected: boolean;
  selectable: boolean;
  onNavigate(path: string): void;
  onSelect(path: string | null): void;
}) {
  const label = entryKindLabel(entry.kind);
  return (
    <button
      type="button"
      className={styles.row}
      disabled={!selectable}
      data-selected={selected ? '' : undefined}
      data-disabled={!selectable ? '' : undefined}
      aria-disabled={!selectable}
      aria-pressed={selectable ? selected : undefined}
      title={path}
      onClick={() => {
        if (!selectable) return;
        onSelect(selected ? null : path);
      }}
      onDoubleClick={() => {
        if (selectable) onNavigate(path);
      }}
      onKeyDown={(event) => {
        if (!selectable || event.key !== 'Enter') return;
        event.preventDefault();
        onNavigate(path);
      }}
    >
      <EntryIcon entry={entry} />
      <span className={styles.rowName}>{entry.name}</span>
      <span className={styles.rowKind}>{label}</span>
    </button>
  );
}

function DirectoryState({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return <div className={cx(styles.state, error && styles.stateError)}>{children}</div>;
}

function EntryIcon({ entry }: { entry: DirectoryEntry }) {
  const props = { className: styles.rowIcon, 'aria-hidden': true } as const;
  switch (entry.kind) {
    case 'directory':
      return <FolderIcon {...props} />;
    case 'repository':
      return <FolderGit2Icon {...props} />;
    case 'file':
      return <FileIcon {...props} />;
    case 'symlink':
      return <Link2Icon {...props} />;
  }
}

function isSelectableEntry(entry: DirectoryEntry): boolean {
  return entry.kind === 'directory' || entry.kind === 'repository';
}

function entryKindLabel(kind: DirectoryEntry['kind']): string {
  switch (kind) {
    case 'directory':
      return 'Folder';
    case 'repository':
      return 'Git repository';
    case 'file':
      return 'File';
    case 'symlink':
      return 'Symlink';
  }
}

function matchesQuery(name: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  return name.toLowerCase().includes(trimmed.toLowerCase());
}

function basename(path: string, separator: '/' | '\\'): string {
  const parts = splitPath(path, separator);
  return parts.at(-1)?.label || path || separator;
}

function joinPath(parent: string, name: string, separator: '/' | '\\'): string {
  if (!parent || parent === separator) return `${separator}${name}`;
  return `${parent.replace(new RegExp(`${escapeRegExp(separator)}+$`), '')}${separator}${name}`;
}

function pathToBreadcrumbs(
  path: string,
  separator: '/' | '\\',
  onNavigate: (path: string) => void
): BreadcrumbItem[] {
  return splitPath(path, separator).map((part, index, parts) => {
    const current = index === parts.length - 1;
    return {
      id: part.path,
      label: part.label,
      onSelect: current ? undefined : () => onNavigate(part.path),
    };
  });
}

function splitPath(path: string, separator: '/' | '\\'): Array<{ label: string; path: string }> {
  if (!path) return [];

  if (separator === '\\') {
    const [root = '', ...rest] = path.split('\\').filter(Boolean);
    const parts = root ? [{ label: root, path: root }] : [];
    for (const segment of rest) {
      const previous = parts.at(-1)?.path ?? root;
      parts.push({ label: segment, path: `${previous}\\${segment}` });
    }
    return parts;
  }

  const segments = path.split('/').filter(Boolean);
  const rootLabel = path.startsWith('/') ? '/' : segments.shift();
  if (!rootLabel) return [];

  const parts = [{ label: rootLabel, path: rootLabel === '/' ? '/' : rootLabel }];
  for (const segment of segments) {
    const previous = parts.at(-1)!.path;
    parts.push({
      label: segment,
      path: previous === '/' ? `/${segment}` : `${previous}/${segment}`,
    });
  }
  return parts;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
