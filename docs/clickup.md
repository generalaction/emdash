# ClickUp integration

Connect ClickUp in **Settings → Integrations → ClickUp**, then select a ticket in
**Add Task → From Issue**. This is separate from the ClickUp MCP server: it supplies
linked issue context to Emdash tasks and works with any coding agent.

## Connect an account

1. Create a personal API token in **ClickUp Settings → Apps**.
2. Choose **Add ClickUp account** in Emdash and enter the token.
3. If you have one accessible Workspace, Emdash selects it automatically. If you have
   several, enter its Workspace ID; the connection form reports the available names
   and IDs when a selection is needed.

Tokens use Emdash's existing encrypted account storage, not repository files. Each
connection identifies a ClickUp user within one Workspace. Add a separate account
connection to work in another Workspace.

## Find and link a task

- The initial list shows open tasks assigned to the connected user, most recently
  updated first, including subtasks.
- Keyword search matches title, description, or identifier among at most the **500
  most recently updated open assigned tasks**. ClickUp's filtered-tasks API has no
  general text-search parameter; this is not a full-Workspace search.
- Paste a custom ID (for example, `ENG-123`), an internal ID, or an
  `https://app.clickup.com/t/...` URL for direct lookup. Direct lookups can include
  closed or unassigned tasks, but must belong to the connected Workspace.
- An alphanumeric keyword can also be an internal ID. Emdash tries direct lookup
  first and falls back to keyword search when a bare ID is not found or is
  inaccessible. Keyword search still checks the connected account's access.
  Explicit ID/URL lookup failures, invalid credentials, and rate limits are reported.

Selected task context includes the Markdown description, status, assignees,
folder/List, priority, checklists, parent link, and direct subtask links when available.
Emdash refreshes the selected ticket using its captured account before task creation.
If that refresh is unavailable, it retains the picker snapshot. Comments, attachments,
and linked Docs are not imported.

Issue-derived task names start with the ticket ID. Enable **Preserve task name
capitalization** in General settings to retain uppercase IDs, and **Include issue
context by default** to send linked context to the agent. Branch names continue to
use the existing Emdash branch naming settings.

The integration makes **GET requests only**. It does not update ClickUp statuses,
post comments, create ClickUp tasks, or create pull requests automatically.

## API references

- [Authentication](https://developer.clickup.com/docs/authentication)
- [Authorized user](https://developer.clickup.com/reference/getauthorizeduser)
- [Authorized Workspaces](https://developer.clickup.com/reference/getauthorizedteams)
- [Filtered Workspace tasks](https://developer.clickup.com/reference/getfilteredteamtasks)
- [Task details and custom IDs](https://developer.clickup.com/reference/gettask)
