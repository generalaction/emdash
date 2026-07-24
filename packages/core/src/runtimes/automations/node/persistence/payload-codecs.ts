import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { z } from 'zod';
import { automationDeploymentSchema, type AutomationDeployment } from '../../api/deployment';
import { automationRunSchema, type AutomationRun } from '../../api/run';

const storedAutomationRunV1Schema = automationRunSchema.extend({
  version: z.literal('1'),
});

const storedAutomationRun = defineVersionedSchema()
  .initial('1', storedAutomationRunV1Schema)
  .build();

const storedAutomationDeploymentV1Schema = automationDeploymentSchema.extend({
  version: z.literal('1'),
});

const storedAutomationDeployment = defineVersionedSchema()
  .initial('1', storedAutomationDeploymentV1Schema)
  .build();

export function serializeRunPayload(run: AutomationRun): string {
  return storedAutomationRun.serialize({ ...run, version: '1' });
}

export function parseRunPayload(payload: string): AutomationRun {
  const result = storedAutomationRun.safeParse(parsePayload(payload, 'run'));
  if (result.status !== 'ok') {
    throw new Error(`Unable to parse stored automation run: ${describeFailure(result)}`);
  }

  const { version: _version, ...run } = result.data;
  return run;
}

export function serializeDeploymentPayload(deployment: AutomationDeployment): string {
  return storedAutomationDeployment.serialize({ ...deployment, version: '1' });
}

export function parseDeploymentPayload(payload: string): AutomationDeployment {
  const result = storedAutomationDeployment.safeParse(parsePayload(payload, 'deployment'));
  if (result.status !== 'ok') {
    throw new Error(`Unable to parse stored automation deployment: ${describeFailure(result)}`);
  }

  const { version: _version, ...deployment } = result.data;
  return deployment;
}

function parsePayload(payload: string, label: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`Stored automation ${label} contains invalid JSON`, { cause: error });
  }
}

function describeFailure(
  result:
    | { status: 'needs-context'; version: string }
    | { status: 'future-version'; version: string }
    | { status: 'invalid'; reason: string }
): string {
  return result.status === 'invalid' ? result.reason : `${result.status} '${result.version}'`;
}
