# Path System

`@emdash/core/path` defines Emdash's portable file identity vocabulary. It is
pure TypeScript, browser-safe, and does not perform filesystem I/O.

Use this module when a path crosses a process, host, renderer, persistence, or
Wire/RPC boundary. Runtime adapters remain responsible for converting structured
refs into native strings immediately before filesystem, Git, watcher, or process
spawn operations.

## Concepts

- `HostId` identifies the host path space. It is opaque and URL-safe.
- `HostAbsolutePath` is a structured absolute path with an explicit root:
  POSIX root, Windows drive, or UNC share.
- `PortableRelativePath` is a normalized `/`-separated coordinate relative to a
  known root. The empty string represents the root.
- `HostFileRef` combines `HostId` and `HostAbsolutePath` into a routeable file
  address.
- `ScopedPath` combines a root `HostFileRef` and `PortableRelativePath`.
- `ResourceUri` is the versioned string form for serialization and persistence.
- `ResourceKey` is an opaque comparison key for maps and deduplication.

## Basic Flow

```ts
import {
  LOCAL_HOST_ID,
  encodeResourceUri,
  hostFileRef,
  parseAbsolute,
  parsePortableRelativePath,
  resolveScopedPath,
  scopedPath,
} from '@emdash/core/path';

const rootPath = parseAbsolute('/repo', { profile: { style: 'posix' } });
const relative = parsePortableRelativePath('src/index.ts');

if (rootPath.success && relative.success) {
  const root = hostFileRef(LOCAL_HOST_ID, rootPath.data);
  const scoped = scopedPath(root, relative.data);
  const resolved = resolveScopedPath(scoped);

  if (resolved.success) {
    const uri = encodeResourceUri(resolved.data);
    // emdash-file://local/v1/posix/repo/src/index.ts
  }
}
```

## Related Pages

- [Normalization](normalization.md)
- [Resources](resources.md)
- [Boundaries](boundaries.md)
- [Recipes](recipes.md)
