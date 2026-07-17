import { Fragment } from 'react';
import { skillsViewDef } from '@core/features/skills/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { SkillsView } from './components/SkillsView';

export function SkillsTitlebar() {
  return <Titlebar />;
}

export function SkillsMainPanel() {
  return <SkillsView />;
}

export const skillsViewRuntime = defineViewRuntime(skillsViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: SkillsTitlebar,
    main: SkillsMainPanel,
  },
});
