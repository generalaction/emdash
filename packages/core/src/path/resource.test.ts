import { describe, expect, it } from 'vitest';
import {
  containsHostFileRef,
  decodeResourceUri,
  encodeResourceUri,
  hostFileRef,
  hostFileRefSchema,
  hostId,
  LOCAL_HOST_ID,
  parseAbsolute,
  parsePortableRelativePath,
  relativizeHostFileRef,
  resourceKeyFromFileRef,
  resolveScopedPath,
  scopedPath,
} from './index';

describe('host file resources', () => {
  it('validates URL-safe opaque host ids', () => {
    expect(hostId('remote_1.example')).toMatchObject({ success: true });
    expect(hostId('ssh:connection-1')).toMatchObject({
      success: false,
      error: { type: 'invalid-host-id' },
    });
    expect(hostId('')).toMatchObject({
      success: false,
      error: { type: 'invalid-host-id' },
    });
  });

  it('resolves and relativizes scoped paths', () => {
    const rootPath = parseAbsolute('/repo', { profile: { style: 'posix' } });
    const relative = parsePortableRelativePath('src/index.ts');
    expect(rootPath.success && relative.success).toBe(true);
    if (!rootPath.success || !relative.success) return;

    const root = hostFileRef(LOCAL_HOST_ID, rootPath.data);
    const scoped = scopedPath(root, relative.data);
    const resolved = resolveScopedPath(scoped);

    expect(resolved).toMatchObject({
      success: true,
      data: {
        hostId: LOCAL_HOST_ID,
        path: { root: { kind: 'posix' }, segments: ['repo', 'src', 'index.ts'] },
      },
    });
    if (!resolved.success) return;

    expect(containsHostFileRef(root, resolved.data)).toBe(true);
    expect(relativizeHostFileRef(root, resolved.data)).toEqual({
      success: true,
      data: 'src/index.ts',
    });
  });

  it('encodes and decodes POSIX resource URIs', () => {
    const path = parseAbsolute('/repo/a b/é.ts', { profile: { style: 'posix' } });
    expect(path.success).toBe(true);
    if (!path.success) return;

    const ref = hostFileRef(LOCAL_HOST_ID, path.data);
    const uri = encodeResourceUri(ref);

    expect(uri).toBe('emdash-file://local/v1/posix/repo/a%20b/%C3%A9.ts');
    expect(decodeResourceUri(uri)).toEqual({ success: true, data: ref });
  });

  it('encodes and decodes drive and UNC resource URIs', () => {
    const drive = parseAbsolute('C:/Users/David/repo', { profile: { style: 'win32' } });
    const unc = parseAbsolute('\\\\server\\share\\repo', { profile: { style: 'win32' } });
    expect(drive.success && unc.success).toBe(true);
    if (!drive.success || !unc.success) return;

    expect(decodeResourceUri(encodeResourceUri(hostFileRef(LOCAL_HOST_ID, drive.data)))).toEqual({
      success: true,
      data: hostFileRef(LOCAL_HOST_ID, drive.data),
    });
    expect(decodeResourceUri(encodeResourceUri(hostFileRef(LOCAL_HOST_ID, unc.data)))).toEqual({
      success: true,
      data: hostFileRef(LOCAL_HOST_ID, unc.data),
    });
  });

  it('rejects malformed resource URIs', () => {
    expect(decodeResourceUri('file:///repo')).toMatchObject({
      success: false,
      error: { type: 'invalid-uri' },
    });
    expect(decodeResourceUri('emdash-file://local/v1/posix/%E0%A4%A')).toMatchObject({
      success: false,
      error: { type: 'invalid-uri' },
    });
  });

  it('creates stable comparison keys without changing display spelling', () => {
    const upper = parseAbsolute('C:/Users/David/Repo.ts', { profile: { style: 'win32' } });
    const lower = parseAbsolute('c:/users/david/repo.ts', { profile: { style: 'win32' } });
    expect(upper.success && lower.success).toBe(true);
    if (!upper.success || !lower.success) return;

    const keyA = resourceKeyFromFileRef(hostFileRef(LOCAL_HOST_ID, upper.data), {
      profile: { style: 'win32' },
    });
    const keyB = resourceKeyFromFileRef(hostFileRef(LOCAL_HOST_ID, lower.data), {
      profile: { style: 'win32' },
    });
    expect(keyA).toBe(keyB);
  });

  it('validates structured refs with schemas', () => {
    const path = parseAbsolute('/repo/src/index.ts', { profile: { style: 'posix' } });
    expect(path.success).toBe(true);
    if (!path.success) return;

    expect(hostFileRefSchema.safeParse(hostFileRef(LOCAL_HOST_ID, path.data)).success).toBe(true);
    expect(
      hostFileRefSchema.safeParse({
        hostId: 'bad host',
        path: path.data,
      }).success
    ).toBe(false);
  });
});
