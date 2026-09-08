import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';
import { workflowStatus } from '../browser/styles/workflow-status.css';

/** Task-domain contribution installed through the desktop Host Styling Adapter. */
export const tasksHostStylesContribution = defineDesktopHostStyleContribution({
  id: 'tasks',
  exports: {
    workflowStatus,
  },
});
