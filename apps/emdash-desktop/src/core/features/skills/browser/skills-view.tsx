import { Fragment } from 'react';
import { SkillsView } from '@core/features/skills/api/browser/components/SkillsView';
import { skillsViewDef } from '@core/features/skills/contributions/views';
import { Titlebar } from '@core/primitives/ui/browser/components/titlebar/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';

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
