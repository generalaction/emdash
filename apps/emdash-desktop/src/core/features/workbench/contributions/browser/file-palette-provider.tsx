import type { PortableRelativePath, ResourceUri } from '@emdash/core/primitives/path/api';
import { Command } from 'cmdk';
import React from 'react';
import { FileIcon } from '@core/features/editor/contributions/browser/file-icon';
import { getSearchClient } from '@core/features/search/api/client';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import {
  matchPaletteText,
  type PaletteProviderDef,
  type PaletteProviderMatch,
  type PaletteProviderQuery,
  type PaletteProviderRenderProps,
} from '@core/primitives/palette/api';
import type { WorkspaceFileHit, WorkspaceFileSearchQuery } from '@core/primitives/search/api';
import { openCommandPaletteFile } from '../../browser/command-palette/open-command-palette-file';
import { PALETTE_ITEM_CLASS } from '../../browser/command-palette/palette-item-styles';

const FILE_SEARCH_LIMIT = 20;

export interface FilePaletteMatch extends PaletteProviderMatch {
  readonly resource: ResourceUri;
  readonly relativePath: PortableRelativePath;
  readonly projectId: string;
  readonly taskId: string;
}

export interface FilePaletteProviderDependencies {
  readonly searchWorkspaceFiles: (
    input: WorkspaceFileSearchQuery
  ) => Promise<readonly WorkspaceFileHit[]>;
}

export function createFilePaletteProviderDef({
  searchWorkspaceFiles,
}: FilePaletteProviderDependencies): PaletteProviderDef {
  return {
    kind: 'files',
    keyword: '@files',
    minQueryLength: 2,
    search: async ({ query, context }: PaletteProviderQuery) => {
      const { projectId, taskId, workspaceId } = context;
      if (!projectId || !taskId || !workspaceId) return [];

      const hits = await searchWorkspaceFiles({
        workspaceId,
        query,
        limit: FILE_SEARCH_LIMIT,
      });

      return hits.flatMap((hit): FilePaletteMatch[] => {
        const relevance = matchPaletteText(query, {
          primary: [hit.filename],
          secondary: [hit.relativePath],
        });
        if (!relevance) return [];

        return [
          {
            id: hit.resource,
            title: hit.filename,
            subtitle: hit.relativePath,
            resource: hit.resource,
            relativePath: hit.relativePath,
            projectId,
            taskId,
            relevance,
          },
        ];
      });
    },
    render: ({ match, value, onSelect }) => (
      <FilePaletteProviderRow match={match as FilePaletteMatch} value={value} onSelect={onSelect} />
    ),
  };
}

function FilePaletteProviderRow({
  match,
  value,
  onSelect,
}: PaletteProviderRenderProps<FilePaletteMatch>) {
  const { navigate } = useNavigate();

  return (
    <Command.Item
      value={value}
      onSelect={() =>
        openCommandPaletteFile(
          {
            resource: match.resource,
            projectId: match.projectId,
            taskId: match.taskId,
          },
          onSelect,
          navigate
        )
      }
      className={PALETTE_ITEM_CLASS}
    >
      <FileIcon filename={match.title} size={14} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
        <span className="shrink-0">{match.title}</span>
        <span className="truncate text-xs text-foreground/40">{match.subtitle}</span>
      </span>
    </Command.Item>
  );
}

export const filePaletteProviderDef = createFilePaletteProviderDef({
  searchWorkspaceFiles: async (input) => {
    const client = await getSearchClient();
    return client.searchWorkspaceFiles(input);
  },
});

export const workbenchFilePaletteProviderDefs = [filePaletteProviderDef] as const;
