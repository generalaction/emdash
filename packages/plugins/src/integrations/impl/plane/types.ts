import type { PlaneClient as PlaneSdkClient, WorkItem } from '@makeplane/plane-node-sdk';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';
import { normalizeHostedInstanceUrl } from '../../helpers/hosted-instance';

export const PLANE_CLOUD_API_BASE_URL = 'https://api.plane.so';

export const planeCredentialsSchema = z.object({
  apiBaseUrl: credentialString('A valid Plane API base URL is required.')
    .transform((value) => normalizeHostedInstanceUrl(value))
    .pipe(z.string('A valid Plane API base URL is required.')),
  workspaceSlug: credentialString('A Plane workspace slug is required.'),
  apiKey: credentialString('A Plane API key is required.'),
});

export type PlaneCredentials = z.infer<typeof planeCredentialsSchema>;

export type PlaneClient = PlaneSdkClient;

export type PlaneWorkItemDetail = WorkItem<'assignees' | 'project' | 'state'>;

export type PlaneVerifiedConnection = {
  displayName?: string;
  displayDetail?: string;
  credentials: PlaneCredentials;
};
