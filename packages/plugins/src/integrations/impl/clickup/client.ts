import { err, ok, type Result } from '@emdash/shared';
import z from 'zod';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import {
  clickUpAuthSchema,
  clickUpCredentialsSchema,
  clickUpUserSchema,
  clickUpWorkspacesSchema,
} from './types';

const API_URL = 'https://api.clickup.com/api/v2/';

/** GET-only client. Never follow a response redirect with an account token. */
export async function clickUpRequest<T>(
  apiKey: string,
  path: string,
  schema: z.ZodType<T>,
  params?: URLSearchParams
): Promise<Result<T, IntegrationError>> {
  const url = new URL(path, API_URL);
  if (url.origin !== new URL(API_URL).origin || !url.pathname.startsWith('/api/v2/')) {
    return err({ type: 'invalid_input', message: 'Invalid ClickUp API path.' });
  }
  if (params) url.search = params.toString();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: apiKey, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      return err({
        type: 'auth_failed',
        message:
          'ClickUp rejected access. Check your token and task permissions in Settings → Integrations → ClickUp.',
      });
    }
    if (response.status === 429) {
      return err({
        type: 'rate_limited',
        message: 'ClickUp rate limit reached. Wait a minute before searching again.',
      });
    }
    if (response.status === 404) {
      return err({
        type: 'not_found_or_no_access',
        message: 'ClickUp task not found or not accessible in this workspace.',
      });
    }
    if (!response.ok) {
      return err({
        type: 'generic',
        message: `ClickUp request failed (HTTP ${response.status}). Try again later.`,
      });
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      return err({ type: 'generic', message: 'ClickUp returned an unexpected response.' });
    }
    return ok(parsed.data);
  } catch {
    // Do not expose request headers, response bodies, or arbitrary upstream errors.
    return err({
      type: 'host_unreachable',
      message: 'Unable to reach ClickUp. Check your connection and try again.',
    });
  }
}

export function readClickUpCredentials(credentials: IntegrationCredentials) {
  return parseCredentials(clickUpCredentialsSchema, credentials);
}

export async function verifyClickUpCredentials(raw: IntegrationCredentials) {
  const parsed = parseCredentials(clickUpAuthSchema, raw);
  if (!parsed.success) return err(parsed.error);
  const { apiKey, workspaceId } = parsed.data;
  const user = await clickUpRequest(apiKey, 'user', z.object({ user: clickUpUserSchema }));
  if (!user.success) return err(user.error);
  const workspaces = await clickUpRequest(apiKey, 'team', clickUpWorkspacesSchema);
  if (!workspaces.success) return err(workspaces.error);

  const teams = workspaces.data.teams;
  const workspace = workspaceId
    ? teams.find((team) => team.id === workspaceId)
    : teams.length === 1
      ? teams[0]
      : undefined;
  if (!workspace) {
    return err<IntegrationError>({
      type: 'invalid_input',
      message: teams.length
        ? `Enter a Workspace ID from the workspaces you can access: ${teams.map((team) => `${team.name} (${team.id})`).join(', ')}.`
        : 'This ClickUp account has no accessible workspaces.',
    });
  }

  const credentials = readClickUpCredentials({
    apiKey,
    workspaceId: workspace.id,
    userId: String(user.data.user.id),
  });
  if (!credentials.success) {
    return err<IntegrationError>({
      type: 'generic',
      message: 'ClickUp returned an unexpected account.',
    });
  }
  return ok({
    account: { id: `${credentials.data.workspaceId}:${credentials.data.userId}` },
    displayName: user.data.user.username || user.data.user.email || 'ClickUp account',
    displayDetail: workspace.name,
    credentials: credentials.data,
  });
}
