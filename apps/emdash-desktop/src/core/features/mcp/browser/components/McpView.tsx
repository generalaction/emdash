import React from 'react';
import { McpPanel } from '@core/features/mcp/contributions/browser/McpPanel';

export const McpView: React.FC = () => (
  <McpPanel
    header={{
      title: 'MCP',
      description: 'Connect your agents with external data sources and tools',
    }}
  />
);
