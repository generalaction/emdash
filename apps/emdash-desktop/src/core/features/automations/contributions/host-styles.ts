import { automationRunBadge, automationRunIcon } from '../browser/styles/automation-run-status.css';

export const automationsHostStylesContribution = {
  id: 'automations',
  exports: {
    automationRunBadge,
    automationRunIcon,
  },
} as const;
