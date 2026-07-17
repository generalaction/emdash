import { createScope } from '@emdash/shared/concurrency';
import { RetrySchedule } from '@emdash/shared/scheduling';
import { createWorkflow, defineWorkflowNode } from '@primitives/workflow/api';

const scope = createScope({ label: 'automation-run' });

const retrySchedule: RetrySchedule = {
  delayFor: () => {},
};

const automationRunWorkflow = createWorkflow({
  scope,
  nodes: [
    defineWorkflowNode({
      id: 'provision-workspace',
      retry: retrySchedule,
      run: async () => {},
    }),
    defineWorkflowNode({
      id: 'start-agent-session',
      dependsOn: ['provision-workspace'],
      retry: retrySchedule,
      run: async () => {},
    }),
  ],
});
