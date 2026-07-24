import { Fragment } from 'react';
import { McpView } from '@core/features/mcp/api/browser/components/McpView';
import { mcpViewDef } from '@core/features/mcp/contributions/views';
import { Titlebar } from '@core/primitives/ui/browser/components/titlebar/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';

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
