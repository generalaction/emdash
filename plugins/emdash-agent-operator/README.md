# Emdash Agent Plugin

This plugin packages a focused agent workflow for Emdash maintainers and users. It is designed to be useful in Codex, Claude Code, Claude Cowork, Copilot-style coworkers, and other `SKILL.md`-compatible harnesses.

The plugin does not add a runtime dependency to Emdash. It gives agents a precise operating procedure, expected outputs, and plugin evals so maintainers can decide whether agent-produced work is good enough to accept.

## What It Includes

- Codex and Claude plugin manifests.
- An Emdash-specific skill at `skills/emdash-agent-operator/SKILL.md`.
- Plugin eval cases in `evals/emdash-agent-operator/cases.jsonl`.
- Privacy-safe measurement guidance for teams that want production plugin metrics.

## Manifest Compatibility

The Codex and Claude manifests use `skills: ./skills/`, which is resolved from the plugin root by the plugin manifest contract. The Codex manifest validates with the local plugin validator used for this contribution.

## Primary Workflows

- Session kickoff matrix.
- Parallel worktree review.
- Handoff compression.
- Completion evidence review.

## Eval Cases

- `parallel-session-plan`: Create a plan for three Emdash agents to implement, review, and document a UI change in separate worktrees.
- `handoff-review`: Review an Emdash session handoff and identify missing verification evidence before merge.
- `stalled-agent-triage`: Triage an agent lane that stopped after a failed command and propose a safe resume path.

## Install In An Agent Harness

Use this plugin directory directly from the repository when your harness supports local or Git-backed plugin sources. The plugin root is:

```text
plugins/emdash-agent-operator
```

For Telvine-backed distribution and metrics, the Telvine CLI is published as [`telvine` on npm](https://www.npmjs.com/package/telvine):

```bash
npm i -g telvine
telvine login
telvine publish ./plugins/emdash-agent-operator
telvine plugins metrics
```

## Telemetry Boundary

The plugin should only record metadata about plugin execution and eval outcomes. Do not record prompts, source files, request bodies, connector payloads, credentials, model outputs, or production user data.
