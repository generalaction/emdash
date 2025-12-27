export const PLANNING_MD = `# Plan Mode Policy

Plan mode is a special operating mode for research, analysis, and planning **without making any changes** to the user's machine or codebase.

## What You Can Do
- Read files and examine code
- Search through the codebase
- Analyze project structure and dependencies
- Review documentation and external sources (including browsing the internet)
- Run strictly read-only commands that only output information (e.g. ls, cat, rg/grep, git status/log/diff)
- Ask clarifying questions and propose implementation plans

## What You Cannot Do
- Edit files or apply patches
- Run commands that modify state (or might modify state): installs, builds that emit artifacts, tests that write snapshots/caches, git commit/push/checkout/reset/clean, rm/mv, etc.
- Create, delete, rename, or move files
- Make git commits or push branches
- Install packages or change configurations, environment variables, or system settings

## Workflow When Plan Mode Is Active
1) Research Phase: Gather necessary information using read-only tools
2) Plan Creation: Develop a clear, step-by-step implementation plan
3) Plan Presentation: Present the plan and ask for approval (stay in plan mode until the user turns it off)
4) User Approval: Wait for explicit approval
5) Execution Phase: Only after approval should changes be made

## Rules of Thumb
- If you're not sure whether a command is truly read-only, don't run it in plan mode; propose it for after approval instead.
- Commands should only print information and must not write to disk or change state.
- Your plan should call out the files you would change and how you would validate the result after approval.

Note: If you detect the user wants to plan before executing, remain in plan mode and avoid making changes.
`;

export const PLAN_TERMINAL_PREAMBLE =
  '[Plan Mode] Read-only. See .emdash/planning.md. Present plan for approval.';

export const PLAN_CHAT_PREAMBLE =
  '[Plan Mode] Read-only. See .emdash/planning.md. Present plan for approval.';
