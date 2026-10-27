# Rename emdash -> Agent (design)

Goal: rename every `emdash` identifier in tracked source to `agent` (case-preserving:
`emdash`->`agent`, `Emdash`->`Agent`, `EMDASH`->`AGENT`), including file/dir names,
workspace package scope `@emdash/*` -> `@agent/*`, env vars, `.emdash.json`, headers.

Kept unchanged (renaming breaks runtime or data):
- Real external endpoints: `*.emdash.sh`, `github.com/generalaction/emdash`,
  `github.com/emdash-ai/emdash` (auth, updater, release downloads).
- Persisted value `emdash_oauth` (stored in user DBs and binary DB fixtures).
- Binary files (DB fixtures) and numbered Drizzle migrations (`drizzle/`).

Accepted consequences: new userData dir (old DB/settings not picked up), existing repos'
`.emdash.json` ignored until renamed, old `branch.*.emdash-pr-url` git config ignored.
