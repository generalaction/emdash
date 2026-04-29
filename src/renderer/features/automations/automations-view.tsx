import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AutomationsView } from './components/AutomationsView';

export function AutomationsTitlebar() {
  return <Titlebar />;
}

export function AutomationsMainPanel() {
  return <AutomationsView />;
}

export const automationsView = {
  TitlebarSlot: AutomationsTitlebar,
  MainPanel: AutomationsMainPanel,
};
