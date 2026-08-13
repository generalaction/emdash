import { addProjectModal } from '../browser/components/add-project-modal/add-project-modal';
import { directorySelectorModal } from '../browser/components/directory-selector-modal';
import { projectConfigImportModal } from '../browser/components/settings-view/project-config-import-modal';
import { shareProjectConfigModal } from '../browser/components/settings-view/share-project-config-modal';
import { projectViewRuntime } from '../browser/view';
import { projectPaletteProviderDefs } from './browser/project-palette-provider';

export const projectsBrowserContributions = {
  views: [projectViewRuntime],
  paletteProviderDefs: projectPaletteProviderDefs,
  modalDefs: [
    addProjectModal,
    shareProjectConfigModal,
    projectConfigImportModal,
    directorySelectorModal,
  ],
} as const;
