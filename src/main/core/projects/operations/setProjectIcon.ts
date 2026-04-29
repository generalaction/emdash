import path from 'node:path';
import { setStoredProjectIconForProject } from '../icons/storage';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function requireAbsolutePath(value: unknown, field: string): string {
  const trimmed = requireString(value, field);
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`${field} must be an absolute path`);
  }
  if (trimmed.includes('\0')) {
    throw new Error(`${field} must not contain null bytes`);
  }
  return trimmed;
}

export async function setProjectIcon(
  projectId: string,
  sourcePath: string
): Promise<{ iconDataUrl: string }> {
  const id = requireString(projectId, 'projectId');
  const source = requireAbsolutePath(sourcePath, 'sourcePath');
  return setStoredProjectIconForProject({ projectId: id, sourcePath: source });
}
