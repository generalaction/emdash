import type { HostRef, HostType } from './types';

export const LOCAL_HOST_REF: HostRef = { type: 'local', id: 'local' };

export function hostRef(type: HostType, id: string): HostRef {
  if (id.length === 0) throw new TypeError('Host id must not be empty');
  if (id.includes('\0')) throw new TypeError('Host id must not contain a null byte');
  return { type, id };
}

export function hostRefEquals(left: HostRef, right: HostRef): boolean {
  return left.type === right.type && left.id === right.id;
}

export function hostRefKey(ref: HostRef): string {
  return `${ref.type}:${encodeURIComponent(ref.id)}`;
}
