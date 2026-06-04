import {
  shareFetchResponseSchema,
  type ShareFetchResponse,
  type ShareType,
} from '../../../../src/shared/share';

export type ShareRow = {
  id: string;
  type: ShareType;
  payload: string;
  created_at: number;
};

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export async function getShareRow(
  db: D1Database,
  type: ShareType,
  id: string
): Promise<ShareRow | null> {
  if (!idPattern.test(id)) return null;

  return await db
    .prepare(
      'SELECT id, type, payload, created_at FROM shares WHERE id = ? AND type = ? AND revoked_at IS NULL'
    )
    .bind(id, type)
    .first<ShareRow>();
}

export function parseStoredShare(row: ShareRow): ShareFetchResponse | null {
  try {
    return shareFetchResponseSchema.parse({
      id: row.id,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload),
    });
  } catch {
    return null;
  }
}

export function typeToPath(type: ShareType): string {
  if (type === 'skill') return 'skills';
  if (type === 'automation') return 'automations';
  return 'prompts';
}
