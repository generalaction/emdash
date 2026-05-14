# Architecture Decision Records

This directory captures architectural decisions for the **emdash-dev** product
(the Tauri 2 + Rust rewrite under `src-tauri/`). It does **not** cover the
Electron emdash codebase, whose conventions live in `agents/architecture/` and
`agents/conventions/`.

## Format

Each ADR follows [Michael Nygard's template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md):

```
# {ADR-NNNN}: {short noun phrase}

## Status

{Proposed | Accepted | Deprecated | Superseded by ADR-XXXX}

## Context

What forces are at play? Constraints, prior art, open questions.

## Decision

What we will do.

## Consequences

What becomes easier and what becomes harder as a result.
```

## Conventions

- **Numbering**: four-digit zero-padded sequence. Never reuse a number, even
  if an ADR is superseded — supersede in place by updating Status.
- **Immutability**: once an ADR is Accepted, do not edit its Context or
  Decision. To change the decision, write a new ADR and mark the old one
  Superseded with a back-reference.
- **Scope**: ADRs are for decisions whose **rationale** would be hard to
  reconstruct from the code alone (e.g., a non-obvious version pin, a
  deliberate departure from upstream convention, a deferred refactor). Don't
  ADR things that are self-evident from a one-line code comment.
- **Authoring**: drafted in the same PR as the change they describe; reviewed
  alongside the code.

## Index

- [0000-template](./0000-template.md) — Template, not a real decision.
- [0001-initial-scaffold](./0001-initial-scaffold.md) — Tauri/specta version
  pins, crate layout, capability-allowlist mechanism, shell_env source.
