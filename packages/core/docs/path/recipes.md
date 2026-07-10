# Recipes

## Parse a Native POSIX Path

```ts
const parsed = parseAbsolute('/home/david/repo/src/index.ts', {
  profile: { style: 'posix' },
});
```

## Parse a Native Windows Path

```ts
const parsed = parseAbsolute('C:\\Users\\David\\repo\\src\\index.ts', {
  profile: { style: 'win32' },
});
```

## Build a Host File Ref

```ts
const host = hostId('remote-1');
const path = parseAbsolute('/repo/src/index.ts', { profile: { style: 'posix' } });

if (host.success && path.success) {
  const ref = hostFileRef(host.data, path.data);
}
```

## Use a Root-Scoped Path

```ts
const root = hostFileRef(LOCAL_HOST_ID, rootPath);
const relative = parsePortableRelativePath('src/index.ts');

if (relative.success) {
  const scoped = scopedPath(root, relative.data);
  const resolved = resolveScopedPath(scoped);
}
```

Use this pattern for watcher events, Git paths, file tree nodes, and bulk file
operations.

## Store a Resource URI

```ts
const uri = encodeResourceUri(ref);
const decoded = decodeResourceUri(uri);
```

Store the URI when a durable string identity is needed. Keep `ResourceKey` for
in-memory maps only.

## Deduplicate with a Resource Key

```ts
const key = resourceKeyFromFileRef(ref, {
  profile: {
    style: 'win32',
    caseSensitivity: 'insensitive',
    unicodeNormalization: 'nfc',
  },
});

modelsByResource.set(key, model);
```

## Convert an Event Under a Watched Root

```ts
const changed = hostFileRef(root.hostId, changedAbsolutePath);
const relative = relativizeHostFileRef(root, changed);

if (relative.success) {
  const scoped = scopedPath(root, relative.data);
}
```

Batch and coalesce watcher events with resource keys derived from the resolved
file refs, not by string-prefix comparisons.

## Handle Errors

All parsing helpers return `Result<T, PathError>`.

```ts
const parsed = parsePortableRelativePath(input);
if (!parsed.success) {
  switch (parsed.error.type) {
    case 'invalid-path':
      return parsed.error.message;
    case 'outside-root':
      return 'Path is outside the selected root';
    default:
      return 'Invalid resource';
  }
}
```
