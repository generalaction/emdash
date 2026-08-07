import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { z } from 'zod';
import {
  workspaceBackgroundSchema,
  workspaceCreateOutcomeSchema,
  workspaceCreationSchema,
  workspaceGitObservationsSchema,
  workspaceRemovalAttemptSchema,
  workspaceScriptOutcomesSchema,
  type WorkspaceBackground,
  type WorkspaceCreateOutcome,
  type WorkspaceCreation,
  type WorkspaceGitObservations,
  type WorkspaceRemovalAttempt,
  type WorkspaceScriptOutcomes,
} from '../../api/schemas';

const storedCreation = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), value: workspaceCreationSchema }))
  .build();

const storedCreateOutcome = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), value: workspaceCreateOutcomeSchema }))
  .build();

const storedGitObservations = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), value: workspaceGitObservationsSchema }))
  .build();

const storedRemovalAttempt = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), value: workspaceRemovalAttemptSchema }))
  .build();

const storedScriptOutcomes = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), value: workspaceScriptOutcomesSchema }))
  .build();

const storedBackground = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), value: workspaceBackgroundSchema }))
  .build();

export function serializeCreationPayload(creation: WorkspaceCreation): string {
  return storedCreation.serialize({ version: '1', value: creation });
}

export function parseCreationPayload(payload: string): WorkspaceCreation {
  return parseVersioned(storedCreation, payload, 'creation');
}

export function serializeCreateOutcomePayload(outcome: WorkspaceCreateOutcome): string {
  return storedCreateOutcome.serialize({ version: '1', value: outcome });
}

export function parseCreateOutcomePayload(payload: string): WorkspaceCreateOutcome {
  return parseVersioned(storedCreateOutcome, payload, 'create outcome');
}

export function serializeGitObservationsPayload(git: WorkspaceGitObservations): string {
  return storedGitObservations.serialize({ version: '1', value: git });
}

export function parseGitObservationsPayload(payload: string): WorkspaceGitObservations {
  return parseVersioned(storedGitObservations, payload, 'git observations');
}

export function serializeRemovalAttemptPayload(attempt: WorkspaceRemovalAttempt): string {
  return storedRemovalAttempt.serialize({ version: '1', value: attempt });
}

export function parseRemovalAttemptPayload(payload: string): WorkspaceRemovalAttempt {
  return parseVersioned(storedRemovalAttempt, payload, 'removal attempt');
}

export function serializeScriptOutcomesPayload(outcomes: WorkspaceScriptOutcomes): string {
  return storedScriptOutcomes.serialize({ version: '1', value: outcomes });
}

export function parseScriptOutcomesPayload(payload: string): WorkspaceScriptOutcomes {
  return parseVersioned(storedScriptOutcomes, payload, 'script outcomes');
}

export function serializeBackgroundPayload(background: WorkspaceBackground): string {
  return storedBackground.serialize({ version: '1', value: background });
}

export function parseBackgroundPayload(payload: string): WorkspaceBackground {
  return parseVersioned(storedBackground, payload, 'background steps');
}

type VersionedEnvelope<T> = {
  safeParse(
    input: unknown
  ):
    | { status: 'ok'; data: { version: '1'; value: T } }
    | { status: 'needs-context'; version: string }
    | { status: 'future-version'; version: string }
    | { status: 'invalid'; reason: string };
};

function parseVersioned<T>(schema: VersionedEnvelope<T>, payload: string, label: string): T {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch (error) {
    throw new Error(`Stored workspace ${label} contains invalid JSON`, { cause: error });
  }
  const result = schema.safeParse(json);
  if (result.status !== 'ok') {
    const detail = result.status === 'invalid' ? result.reason : `${result.status}`;
    throw new Error(`Unable to parse stored workspace ${label}: ${detail}`);
  }
  return result.data.value;
}
