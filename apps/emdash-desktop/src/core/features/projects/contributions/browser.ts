import { AddProjectModal } from '../browser/components/add-project-modal/add-project-modal';
import { ProjectConfigImportModal } from '../browser/components/settings-view/project-config-import-modal';
import { ShareProjectConfigModal } from '../browser/components/settings-view/share-project-config-modal';
import { projectView } from '../browser/view';

export const projectsBrowserContributions = {
  views: {
    project: projectView,
  },
  modals: {
    addProjectModal: {
      component: AddProjectModal,
    },
    shareProjectConfigModal: {
      component: ShareProjectConfigModal,
      size: 'md',
    },
    projectConfigImportModal: {
      component: ProjectConfigImportModal,
      size: 'md',
    },
  },
} as const;
