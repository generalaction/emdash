import { CreateSkillModal } from '../browser/components/CreateSkillModal';
import { skillsView } from '../browser/skills-view';

export const skillsBrowserContributions = {
  views: {
    skills: skillsView,
  },
  modals: {
    createSkillModal: {
      component: CreateSkillModal,
    },
  },
} as const;
