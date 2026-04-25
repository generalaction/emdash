import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import SkillsView from './components/SkillsView';

export function SkillsTitlebar() {
  return <Titlebar />;
}

export function SkillsMainPanel() {
  return <SkillsView />;
}

export const skillsView = {
  TitlebarSlot: SkillsTitlebar,
  MainPanel: SkillsMainPanel,
};
