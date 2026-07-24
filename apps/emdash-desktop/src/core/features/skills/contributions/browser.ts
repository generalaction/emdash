import { createSkillModal } from '../browser/components/CreateSkillModal';
import { skillsViewRuntime } from '../browser/skills-view';

export const skillsBrowserContributions = {
  views: [skillsViewRuntime],
  modalDefs: [createSkillModal],
} as const;
