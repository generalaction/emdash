---
name: emdash-agent-operator
description: Operate Emdash multi-agent workspaces with verifiable handoffs. Use this skill when an agent is asked to plan, build, review, or verify Emdash workflows and needs plugin-specific acceptance criteria.
---

# Emdash Agent Plugin

This skill turns a broad agent request into an Emdash-specific workflow with explicit verification evidence. It is intentionally operational: it should produce a plan, the expected artifacts, and plugin eval metadata that another maintainer can review.

## Capabilities

- Multi-agent session planning.
- Worktree tracking.
- Handoff review.
- Completion verification.

## Workflow

1. Session kickoff matrix.
2. Parallel worktree review.
3. Handoff compression.
4. Completion evidence review.

## Required Output

Return a concise implementation or review note with these sections:

- `Scope`: the exact Emdash workflow, repository area, and user-facing outcome.
- `Inputs`: non-secret configuration, sample IDs, file paths, docs, or local commands needed to proceed.
- `Plan`: ordered steps the agent should take, including where human approval is required.
- `Verification`: commands, UI checks, fixtures, screenshots, traces, or logs that prove the plugin workflow behaved correctly.
- `Plugin Eval Metadata`: the eval case id, expected pass criteria, and any safe metadata events to record.
- `Risks`: unresolved assumptions, missing credentials, destructive operations, or compatibility concerns.

## Acceptance Checks

- Names each agent lane and expected artifact.
- Tracks repo branch/worktree status before and after each lane.
- Requires tests or review evidence before marking work complete.
- Records human decisions separately from model output.

## Privacy And Telemetry Boundary

Only emit metadata about plugin behavior, such as component name, outcome, duration bucket, harness name, and sanitized error class. Do not emit prompts, file contents, connector payloads, API tokens, request bodies, model outputs, user data, or production identifiers.

## Optional Telvine Measurement

Teams that publish this plugin through Telvine can measure adoption and eval outcomes without changing Emdash runtime code. The CLI package is published as `telvine` on npm: https://www.npmjs.com/package/telvine

```bash
npm i -g telvine
telvine login
telvine publish ./plugins/emdash-agent-operator
telvine plugins metrics
```

## Manifest Path Note

The plugin manifests use `skills: ./skills/` because the supported plugin manifest contract resolves that path from the plugin root, not from the hidden manifest directory.
