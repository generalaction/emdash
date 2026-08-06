import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import React, { useState } from 'react';
import { PageHeader } from '@core/primitives/ui/browser/components/page-header';
import type { McpDrawerMode } from '../../../browser/components/McpDrawer';
import { useMcps } from '../../../browser/components/useMcps';
import { McpServersList } from './McpServersList';
import { McpToolbar } from './McpToolbar';

type McpPanelProps = {
  host?: HostRef;
  header?: { title: string; description: string };
};

export function McpPanel({ host = LOCAL_HOST_REF, header }: McpPanelProps) {
  const mcp = useMcps(host);
  const [search, setSearch] = useState('');
  const [drawerMode, setDrawerMode] = useState<McpDrawerMode | null>(null);

  const toolbar = (
    <McpToolbar
      search={search}
      onSearchChange={setSearch}
      onRefresh={mcp.refresh}
      isRefreshing={mcp.isRefreshing}
      onAddCustom={() => setDrawerMode({ type: 'add-custom' })}
    />
  );

  return (
    <div className="flex flex-col text-foreground">
      {header ? (
        <PageHeader sticky title={header.title} description={header.description}>
          {toolbar}
        </PageHeader>
      ) : (
        toolbar
      )}
      <McpServersList
        mcp={mcp}
        search={search}
        drawerMode={drawerMode}
        onDrawerModeChange={setDrawerMode}
      />
    </div>
  );
}
