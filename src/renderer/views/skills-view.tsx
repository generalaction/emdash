import SkillsView from '@renderer/components/skills/SkillsView';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';

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
