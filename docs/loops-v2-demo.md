# ACP Loops v2

ACP Loops turn an implementation plan into ordered, resumable work phases. Each phase runs in
the task's own workspace and records checkpoints, attempts, handoffs, and verification evidence.
The optional terminal Review and clean-room E2E phases gate completion.

## Demos

- [Summario feature built by a Loop (1.2×, 11 seconds)](./assets/loops-v2/01-summario-feature-built-1.2x.webm)
  shows the completed Summario dogfood run, including its implementation phases, Review, browser
  verification, and final handoffs.
- [Plan to running Loop (1.2×, 38 seconds)](./assets/loops-v2/02-plan-to-running-loop-1.2x.webm)
  uses a synthetic local repository to show a Markdown plan being converted into two editable
  phases, the task being created, and the Loop moving from Draft to Running.

Both videos were trimmed to the relevant interactions, encoded as 1280×1024 VP9 WebM at 20 fps,
and reviewed frame-by-frame for secrets and real user data.

## Implementation and rebase notes

- Adds persisted Loop definitions and phases, authoring from the Create Task modal, a native Loop
  tab, ACP execution, pause/resume/retry controls, checkpoint validation, phase handoffs, terminal
  Review, and clean-room browser E2E verification.
- Rebases the implementation onto current `main` and regenerates the unshipped Loop migration as
  migration `0020`, avoiding the migration number that landed upstream while this work was in
  progress.
- Ports Loop ACP execution to the current shared ACP runtime while preserving local and SSH target
  selection, task environment, session persistence, and permission handling.
- Adds the missing Draft-to-Running action discovered during the desktop walkthrough.
- Prevents a successful clean-room retry from presenting an earlier failed attempt as the current
  terminal handoff; the failed attempt remains available in retry history.

## Review and verification

The branch was reviewed after rebasing for runtime compatibility, migrations, renderer/main RPC
boundaries, workspace targeting, environment and secret handling, stale imports, and E2E state
reporting. The compatibility, migration, stale-state, and missing-start findings were fixed before
recording these demos.

The final verification commands and their results are recorded in the pull request description.
