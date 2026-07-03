import { readCredentialString } from '../../helpers/credentials';
import {
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from '../../helpers/hosted-instance';
import type { IntegrationCredentials } from '../../host';

export const PLANE_CLOUD_API_BASE_URL = 'https://api.plane.so';

type QueryValue = string | number | boolean | null | undefined;

export type PlaneProject = {
  id: string;
  identifier?: string;
  name?: string;
};

export type PlaneWorkItem = {
  id: string;
  name?: string;
  description_html?: string | null;
  description_stripped?: string | null;
  priority?: string | null;
  sequence_id?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  project?: unknown;
  state?: unknown;
  assignees?: unknown;
};

export type PlaneUser = {
  id?: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export class PlaneHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'PlaneHttpError';
  }
}

export class PlaneInvalidResponseError extends Error {
  constructor(message = 'Unexpected Plane API response.') {
    super(message);
    this.name = 'PlaneInvalidResponseError';
  }
}

export class PlaneClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly apiKey: string
  ) {}

  async getCurrentUser(): Promise<PlaneUser> {
    const data = await this.getUnknown('/api/v1/users/me/');
    if (!isRecord(data)) throw new PlaneInvalidResponseError();
    return data as PlaneUser;
  }

  async listProjects(workspaceSlug: string, limit: number): Promise<PlaneProject[]> {
    const data = await this.getUnknown(
      `/api/v1/workspaces/${encodePath(workspaceSlug)}/projects/`,
      { per_page: limit, limit }
    );
    return parseProjects(data);
  }

  async listWorkItems(
    workspaceSlug: string,
    projectId: string,
    limit: number
  ): Promise<PlaneWorkItem[]> {
    const data = await this.getUnknown(
      `/api/v1/workspaces/${encodePath(workspaceSlug)}/projects/${encodePath(projectId)}/work-items/`,
      { per_page: limit, limit, expand: 'assignees,state,project' }
    );
    return parseWorkItems(data);
  }

  async searchWorkItems(
    workspaceSlug: string,
    search: string,
    limit: number
  ): Promise<PlaneWorkItem[]> {
    const data = await this.getUnknown(
      `/api/v1/workspaces/${encodePath(workspaceSlug)}/work-items/search/`,
      { search, limit, per_page: limit, expand: 'assignees,state,project' }
    );
    return parseWorkItems(data);
  }

  async getWorkItemByIdentifier(workspaceSlug: string, identifier: string): Promise<PlaneWorkItem> {
    const data = await this.getUnknown(
      `/api/v1/workspaces/${encodePath(workspaceSlug)}/work-items/${encodePath(identifier)}/`,
      { expand: 'assignees,state,project' }
    );
    const item = parseWorkItem(data);
    if (!item) throw new PlaneInvalidResponseError();
    return item;
  }

  private async getUnknown(path: string, query: Record<string, QueryValue> = {}): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-API-Key': this.apiKey },
    });

    if (!response.ok) {
      throw new PlaneHttpError(
        response.status,
        response.statusText,
        await readErrorMessage(response)
      );
    }

    try {
      return await response.json();
    } catch {
      throw new PlaneInvalidResponseError();
    }
  }

  private buildUrl(path: string, query: Record<string, QueryValue>): URL {
    const base = new URL(this.apiBaseUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    const endpointPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base.origin}${basePath}${endpointPath}`);

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    return url;
  }
}

let client: PlaneClient | null = null;
let clientKey: string | null = null;

export type PlaneCredentials = {
  apiBaseUrl: string;
  workspaceSlug: string;
  apiKey: string;
};

export type PlaneAuth = PlaneCredentials & {
  client: PlaneClient;
};

export function readPlaneCredentials(credentials: IntegrationCredentials): PlaneCredentials {
  const apiBaseUrl = normalizeHostedInstanceUrl(
    readCredentialString(credentials, 'apiBaseUrl') ?? ''
  );
  if (!apiBaseUrl) throw new Error('A valid Plane API base URL is required.');

  const workspaceSlug = readString(credentials.workspaceSlug);
  if (!workspaceSlug) throw new Error('A Plane workspace slug is required.');

  const apiKey = readCredentialString(credentials, 'apiKey');
  if (!apiKey) throw new Error('A Plane API key is required.');

  return { apiBaseUrl, workspaceSlug, apiKey };
}

export function getPlaneAuth(credentials: IntegrationCredentials): PlaneAuth {
  const parsed = readPlaneCredentials(credentials);
  const key = `${parsed.apiBaseUrl}|${parsed.apiKey}`;
  if (!client || clientKey !== key) {
    client = new PlaneClient(parsed.apiBaseUrl, parsed.apiKey);
    clientKey = key;
  }
  return { ...parsed, client };
}

export function toPlaneErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlaneHttpError) {
    if (error.status === 401 || error.status === 403) {
      return 'Plane authentication failed. Check your API key and permissions.';
    }
    if (error.status === 404) return 'Plane workspace, project, or work item not found.';
    if (error.status === 429) return 'Plane API rate limit exceeded. Please try again shortly.';
    if (error.status >= 500) return 'Plane API is temporarily unavailable. Please try again.';
    return error.message || fallback;
  }

  if (error instanceof PlaneInvalidResponseError) return error.message;
  if (hasKnownNetworkErrorCode(error)) {
    return 'Unable to reach Plane instance. Check your URL and network connection.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function verifyPlaneCredentials(credentials: IntegrationCredentials) {
  const auth = getPlaneAuth(credentials);
  const user = await auth.client.getCurrentUser();
  await auth.client.listProjects(auth.workspaceSlug, 1);
  return {
    displayName: toDisplayName(user),
    displayDetail: toDisplayDetail(auth.workspaceSlug, auth.apiBaseUrl),
    credentials: {
      apiBaseUrl: auth.apiBaseUrl,
      workspaceSlug: auth.workspaceSlug,
      apiKey: auth.apiKey,
    },
  };
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function parseProjects(data: unknown): PlaneProject[] {
  return getResultArray(data)
    .map(parseProject)
    .filter((project): project is PlaneProject => project !== null);
}

function parseProject(value: unknown): PlaneProject | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  if (!id) return null;
  return {
    id,
    identifier: readString(value.identifier) ?? undefined,
    name: readString(value.name) ?? undefined,
  };
}

function parseWorkItems(data: unknown): PlaneWorkItem[] {
  return getResultArray(data)
    .map(parseWorkItem)
    .filter((item): item is PlaneWorkItem => item !== null);
}

function parseWorkItem(value: unknown): PlaneWorkItem | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  if (!id) return null;
  return {
    id,
    name: readString(value.name) ?? undefined,
    description_html: readNullableString(value.description_html),
    description_stripped:
      readNullableString(value.description_stripped) ?? readNullableString(value.description_text),
    priority: readNullableString(value.priority),
    sequence_id: readNumberOrString(value.sequence_id),
    created_at: readNullableString(value.created_at),
    updated_at: readNullableString(value.updated_at),
    project: value.project,
    state: value.state,
    assignees: value.assignees,
  };
}

function getResultArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
  }
  throw new PlaneInvalidResponseError();
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    const message = extractErrorMessage(data);
    if (message) return message;
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Plane API request failed with status ${response.status}.`;
}

function extractErrorMessage(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (!isRecord(data)) return null;

  const direct = readString(data.message) ?? readString(data.detail) ?? readString(data.error);
  if (direct) return direct;

  if (Array.isArray(data.errors)) {
    const first = data.errors.find((item) => {
      if (typeof item === 'string') return item.trim().length > 0;
      return isRecord(item) && typeof item.message === 'string' && item.message.trim().length > 0;
    });
    if (typeof first === 'string') return first.trim();
    if (isRecord(first)) return readString(first.message);
  }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return readString(value);
}

function readNumberOrString(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return readString(value);
}

function toDisplayName(user: PlaneUser): string | undefined {
  const displayName = readString(user.display_name);
  if (displayName) return displayName;

  const fullName = [readString(user.first_name), readString(user.last_name)]
    .filter(Boolean)
    .join(' ');
  return fullName || readString(user.email) || undefined;
}

function toDisplayDetail(workspaceSlug: string, apiBaseUrl: string): string {
  try {
    const host = new URL(apiBaseUrl).host;
    return `${workspaceSlug} on ${host}`;
  } catch {
    return workspaceSlug;
  }
}
