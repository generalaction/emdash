# Resources

`HostFileRef` is the canonical application-level file identity:

```ts
type HostFileRef = {
  hostId: HostId;
  path: HostAbsolutePath;
};
```

It identifies a logical path on a host. It is not an inode identity. Symlinks,
hard links, and renames are handled by runtime-specific filesystem behavior.

## Host IDs

`HostId` is opaque and URL-safe. The local host uses `LOCAL_HOST_ID`.

Do not encode a transport detail such as an SSH connection ID into persistent
resource identity unless a higher-level host registry has made that value stable.

## Absolute Roots

Structured roots avoid ambiguity across hosts and drives:

```ts
{ kind: 'posix' }
{ kind: 'drive', driveLetter: 'C' }
{ kind: 'unc', server: 'server', share: 'share' }
```

The path segments are stored separately from the root, so `/`, `C:/`, and
`//server/share` cannot be confused.

## Scoped Paths

Use `ScopedPath` when many operations share a root:

```ts
type ScopedPath = {
  root: HostFileRef;
  relative: PortableRelativePath;
};
```

This is the preferred shape for Git paths, watcher events, tree entries, and
batch operations. Resolve it into a `HostFileRef` only when the full address is
needed.

## Resource URIs

`ResourceUri` is the stable string encoding:

```text
emdash-file://local/v1/posix/home/david/repo/src/index.ts
emdash-file://remote-1/v1/drive/c/Users/David/repo/src/index.ts
emdash-file://remote-2/v1/unc/server/share/repo/src/index.ts
```

Use it for serialization, persistence, Monaco model identity, and durable
messages. Percent encoding is applied per path segment.

## Resource Keys

`ResourceKey` is an opaque comparison key for maps and deduplication. It may be
case-insensitive or Unicode-normalized depending on the selected profile.

Do not persist `ResourceKey` as the only representation of a file. It is lossy by
design and may not preserve display spelling.
