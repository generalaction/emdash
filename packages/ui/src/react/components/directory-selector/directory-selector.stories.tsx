import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  DirectorySelector,
  type DirectoryEntry,
  type DirectoryListing,
} from './directory-selector';
import { useDirectoryHistory } from './use-directory-history';

const meta: Meta<typeof DirectorySelector> = {
  title: 'Components/DirectorySelector',
  component: DirectorySelector,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof DirectorySelector>;

const mockFs: Record<string, DirectoryEntry[]> = {
  '/home/user': [
    { name: 'repos', kind: 'directory' },
    { name: 'emdash', kind: 'repository' },
    { name: 'Downloads', kind: 'directory' },
    { name: 'empty-folder', kind: 'directory' },
    { name: '.zshrc', kind: 'file' },
  ],
  '/home/user/repos': [
    { name: 'emdash', kind: 'repository' },
    { name: 'plugins', kind: 'directory' },
    { name: 'README.md', kind: 'file' },
  ],
  '/home/user/repos/emdash': [
    { name: 'apps', kind: 'directory' },
    { name: 'packages', kind: 'directory' },
    { name: '.git', kind: 'directory' },
    { name: 'package.json', kind: 'file' },
    { name: 'pnpm-lock.yaml', kind: 'file' },
  ],
  '/home/user/repos/emdash/apps': [
    { name: 'emdash-desktop', kind: 'repository' },
    { name: 'README.md', kind: 'file' },
  ],
  '/home/user/repos/emdash/packages': [
    { name: 'ui', kind: 'repository' },
    { name: 'core', kind: 'directory' },
    { name: 'shared', kind: 'directory' },
  ],
  '/home/user/repos/plugins': [
    { name: 'providers', kind: 'directory' },
    { name: 'current', kind: 'symlink' },
  ],
  '/home/user/emdash': [
    { name: 'src', kind: 'directory' },
    { name: '.git', kind: 'directory' },
    { name: 'README.md', kind: 'file' },
  ],
  '/home/user/Downloads': [
    { name: 'archive.zip', kind: 'file' },
    { name: 'screenshots', kind: 'directory' },
  ],
  '/home/user/Downloads/screenshots': [
    { name: 'settings.png', kind: 'file' },
    { name: 'workbench.png', kind: 'file' },
  ],
  '/home/user/empty-folder': [],
};

const windowsFs: Record<string, DirectoryEntry[]> = {
  'C:': [{ name: 'Users', kind: 'directory' }],
  'C:\\Users': [{ name: 'david', kind: 'directory' }],
  'C:\\Users\\david': [
    { name: 'Documents', kind: 'directory' },
    { name: 'emdash', kind: 'repository' },
    { name: 'notes.txt', kind: 'file' },
  ],
  'C:\\Users\\david\\Documents': [
    { name: 'repos', kind: 'directory' },
    { name: 'designs', kind: 'directory' },
  ],
};

export const Interactive: Story = {
  render: () => <MockDirectorySelector initialPath="/home/user" fs={mockFs} />,
};

export const Loading: Story = {
  args: {
    path: '/home/user',
    listing: { status: 'loading' },
    selectedPath: null,
    canGoBack: false,
    canGoForward: false,
    onBack: noop,
    onForward: noop,
    onNavigate: noop,
    onSelect: noop,
  },
  render: (args) => (
    <div style={{ width: '34rem' }}>
      <DirectorySelector {...args} />
    </div>
  ),
};

export const Error: Story = {
  args: {
    path: '/home/user/private',
    listing: { status: 'error', message: 'Permission denied' },
    selectedPath: null,
    canGoBack: true,
    canGoForward: false,
    onBack: noop,
    onForward: noop,
    onNavigate: noop,
    onSelect: noop,
  },
  render: (args) => (
    <div style={{ width: '34rem' }}>
      <DirectorySelector {...args} />
    </div>
  ),
};

export const EmptyFolder: Story = {
  args: {
    path: '/home/user/empty-folder',
    listing: { status: 'ready', entries: [] },
    selectedPath: null,
    canGoBack: true,
    canGoForward: false,
    onBack: noop,
    onForward: noop,
    onNavigate: noop,
    onSelect: noop,
  },
  render: (args) => (
    <div style={{ width: '34rem' }}>
      <DirectorySelector {...args} />
    </div>
  ),
};

export const WithSelection: Story = {
  args: {
    path: '/home/user',
    listing: { status: 'ready', entries: mockFs['/home/user']! },
    selectedPath: '/home/user/emdash',
    canGoBack: false,
    canGoForward: false,
    onBack: noop,
    onForward: noop,
    onNavigate: noop,
    onSelect: noop,
  },
  render: (args) => (
    <div style={{ width: '34rem' }}>
      <DirectorySelector {...args} />
    </div>
  ),
};

export const WindowsSeparator: Story = {
  render: () => (
    <MockDirectorySelector initialPath="C:\\Users\\david" fs={windowsFs} separator={'\\'} />
  ),
};

function MockDirectorySelector({
  initialPath,
  fs,
  separator = '/',
}: {
  initialPath: string;
  fs: Record<string, DirectoryEntry[]>;
  separator?: '/' | '\\';
}) {
  const history = useDirectoryHistory(initialPath);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [listing, setListing] = React.useState<DirectoryListing>({ status: 'loading' });

  React.useEffect(() => {
    setSelectedPath(null);
    setListing({ status: 'loading' });
    const timer = window.setTimeout(() => {
      const entries = fs[history.path];
      setListing(
        entries
          ? { status: 'ready', entries }
          : { status: 'error', message: `Folder not found: ${history.path}` }
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fs, history.path]);

  return (
    <div style={{ width: '34rem' }}>
      <DirectorySelector
        path={history.path}
        listing={listing}
        selectedPath={selectedPath}
        canGoBack={history.canGoBack}
        canGoForward={history.canGoForward}
        onBack={history.back}
        onForward={history.forward}
        onNavigate={history.navigate}
        onSelect={setSelectedPath}
        separator={separator}
      />
    </div>
  );
}

function noop() {}
