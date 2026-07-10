# Boundaries

The path module owns pure identity and lexical path math. It does not own host
lifecycle, filesystem I/O, authorization, or persistence migrations.

## Conversion Points

```mermaid
flowchart LR
  NativeInput[Native string] --> Parser[Path parser]
  Parser --> Ref[HostFileRef]
  Ref --> Rpc[RPC or Wire]
  Rpc --> Resolver[Host resolver]
  Resolver --> NativeOutput[Native string]
  NativeOutput --> Fs[Filesystem or Git]
```

Convert at these boundaries:

- User input, picker output, SSH responses, and Git roots become structured refs
  at ingress.
- Renderer, Wire, worker, and persistence payloads use `ResourceUri`,
  `HostFileRef`, or `ScopedPath`, not raw native strings.
- Host runtimes convert structured refs back to native strings immediately before
  filesystem, Git, watcher, or process-spawn calls.
- Watcher and Git events should become `ScopedPath` values before crossing to
  renderer-facing models.

## Lexical Versus Physical Containment

`containsAbsolute()` and `relativizeHostFileRef()` are lexical. They do not
follow symlinks.

Use lexical containment for identity, tree projection, deduplication, batching,
and root-relative path conversion.

Use realpath-based containment for security-sensitive writes, deletes, and
filesystem mutation policies. That logic belongs in runtime or app services with
access to a filesystem implementation.

## Not Owned Here

This module intentionally does not implement:

- `HostRegistry` or mapping from `HostId` to a live runtime;
- SSH connection management;
- workspace mount persistence;
- `realpath()` or canonical inode checks;
- renderer tab migrations;
- Monaco model migration;
- Wire contract migrations;
- filesystem authorization.

## Future Adoption Map

Existing consumers can migrate incrementally:

- `packages/core/src/files/paths.ts` can delegate validation and lexical
  containment to `@emdash/core/path`.
- `packages/core/src/files/path-policy.ts` can be replaced by `ScopedPath`
  helpers plus runtime-specific realpath checks.
- Desktop `RuntimePath` can become a thin native-format adapter around
  `PathSemantics`.
- SSH path helpers can use POSIX parsing explicitly instead of app-local string
  utilities.
- Git models can keep repo-relative paths as `PortableRelativePath`.
- fs-watch can emit root-scoped portable paths, then batch using `ResourceKey`.
- workspace-server schemas can validate structured refs instead of documenting
  string conventions only.
- Renderer tabs, tree nodes, Monaco models, comments, and view-state snapshots
  can store `ResourceUri` while deriving display paths from workspace mounts.
