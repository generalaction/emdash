import { Fragment } from 'react';
import { McpView } from '@core/features/mcp/browser/components/McpView';
import { mcpViewDef } from '@core/features/mcp/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';

export function McpTitlebar() {
  return <Titlebar />;
}

export function McpMainPanel() {
  return <McpView />;
}

export const mcpViewRuntime = defineViewRuntime(mcpViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: McpTitlebar,
    main: McpMainPanel,
  },
});
