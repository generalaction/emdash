import { McpView } from '@renderer/components/mcp/McpView';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';

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
