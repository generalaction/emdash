import { languageServicesDialog } from '../browser/lsp/language-status';
import { conflictDialog } from '../browser/task-editor/conflict-dialog';

export const editorBrowserContributions = {
  modalDefs: [conflictDialog, languageServicesDialog],
} as const;
