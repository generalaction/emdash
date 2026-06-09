import { McpView } from '@renderer/features/mcp/components/McpView';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';

export function McpTitlebar() {
  return <Titlebar />;
}

export function McpMainPanel() {
  return <McpView />;
}

export const mcpView = {
  TitlebarSlot: McpTitlebar,
  MainPanel: McpMainPanel,
};
