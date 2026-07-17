import { CreateSkillModal } from '../browser/components/CreateSkillModal';
import { skillsViewRuntime } from '../browser/skills-view';

export const skillsBrowserContributions = {
  views: [skillsViewRuntime],
  modals: {
    createSkillModal: {
      component: CreateSkillModal,
    },
  },
} as const;
