# Decisions and current work

<!-- Written by `knos export`. Commit this file. -->

<!--
Reading this file needs nothing installed: it is plain markdown, and a fresh
clone picks it up as-is. The live claim/withhold server is a separate, optional
step - `pip install knos` (Python 3.10+), which the MCP entry launches as
`python -m knos.mcp`. Without it, everything below still reads normally.
-->


A second clone reads this on its first question - it is one of the decision
records knos looks for. Nothing here is private: secrets and private paths
never reach it.


## Decisions

- **worktrees live under the project's configured directory** - Task worktrees are created under the project's DB-backed worktree directory setting rather than a fixed path.  _(agents/workflows/worktrees.md)_
- **branch prefix is configurable, suffix is random** - The prefix defaults to `emdash` and is configurable in app settings; generated task branch names add a random suffix by default, and repository settings can disable only the suffix.  _(agents/workflows/worktrees.md)_
- **creation is a four-step foreground pipeline** - `inspect -> resolve-base -> add-worktree -> verify`, with the base ref fetched only when it is not locally resolvable.  _(agents/workflows/worktrees.md)_
- **worktree creation goes through the provider pattern** - It is managed by the project provider rather than called directly.  _(agents/workflows/worktrees.md)_

## Being worked on right now

_Nothing claimed._

---
<sub>knos export. Claims lapse after 30 minutes.</sub>
