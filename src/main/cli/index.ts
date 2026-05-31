/**
 * `emdash` CLI entry point.
 *
 * Runs against the same SQLite database as the desktop app. The launcher
 * (bin/emdash-cli.mjs) sets EMDASH_DB_FILE before this module loads and runs us
 * under Electron-as-Node so the better-sqlite3 native ABI matches.
 *
 * Commands:
 *   emdash workspace list   [--project <name>] [--include-archived] [--json]
 *   emdash workspace create --project <p> --branch <b> [--base <branch>]
 *                           [--name <n>] [--checkout-existing | --no-worktree] [--json]
 */

import { resolveProviderEnv } from '@main/core/conversations/impl/provider-env';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { LocalProjectSettingsProvider } from '@main/core/projects/settings/providers/local-project-settings-provider';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { db } from '@main/db/client';
import { dispatchAgent } from './agent-dispatch';
import { getBool, getString, parseArgs, type ParsedArgs } from './args';
import {
  createWorkspace,
  listWorkspaces,
  removeWorkspace,
  resolveProject,
  sendToWorkspace,
  type CreateAgentDispatcher,
  type WorkspaceStrategy,
} from './workspace-commands';

const USAGE = `emdash — workspace CLI

Usage:
  emdash workspace list   [--project <name>] [--include-archived] [--json]
  emdash workspace create --project <p> --branch <b> [--base <branch>] [--name <n>]
                          [--checkout-existing | --no-worktree] [--push-branch]
                          [--prompt "<text>" [--agent <name>] [--auto-approve]] [--json]
  emdash workspace remove --project <p> (--branch <b> | --id <workspaceId>)
                          [--pre-remove <cmd>] [--skip-hook] [--force] [--json]
  emdash workspace send   --project <p> (--branch <b> | --id <workspaceId>)
                          --message "<text>" [--json]

Options:
  -p, --project   Project name or id
  -b, --branch    Branch name for the workspace
  -m, --message   Message to dispatch to the worktree's agent (send)
      --base      Source branch to fork from (default: project base ref, e.g. origin/main)
      --name      Task display name (default: branch name)
      --prompt    Launch the agent and seed it with this prompt (one-shot dispatch; needs tmux mode)
      --agent     Agent provider for --prompt (default: claude)
      --auto-approve  Launch the agent with permissions auto-approved
      --push-branch   Publish the new branch to the push remote
      --id        Target workspace id (remove / send)
      --pre-remove <cmd>  Capture command run in the worktree before teardown
                          (also reads EMDASH_PRE_REMOVE). Aborts remove if it fails.
      --skip-hook Skip the pre-remove hook
      --force     Remove even if the pre-remove hook fails
      --json      Machine-readable JSON output
      --include-archived  Include archived workspaces in the list
`;

async function runList(args: ParsedArgs): Promise<void> {
  const items = await listWorkspaces(db, {
    project: getString(args, 'project'),
    includeArchived: getBool(args, 'include-archived'),
  });

  if (getBool(args, 'json')) {
    process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
    return;
  }

  if (items.length === 0) {
    process.stdout.write('No workspaces found.\n');
    return;
  }

  const rows = items.map((item) => ({
    id: item.id,
    project: item.project ?? '—',
    branch: item.branch ?? '—',
    type: item.type,
    archived: item.archived ? 'yes' : 'no',
    path: item.path ?? '—',
  }));
  const columns: Array<keyof (typeof rows)[number]> = [
    'id',
    'project',
    'branch',
    'type',
    'archived',
    'path',
  ];
  const widths = Object.fromEntries(
    columns.map((col) => [col, Math.max(col.length, ...rows.map((r) => String(r[col]).length))])
  ) as Record<string, number>;

  const line = (cells: Record<string, string>) =>
    columns.map((col) => String(cells[col]).padEnd(widths[col]!)).join('  ');

  process.stdout.write(`${line(Object.fromEntries(columns.map((c) => [c, c])))}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(row as Record<string, string>)}\n`);
  }
}

/**
 * Builds the real project settings provider so the worktree directory and
 * preserve patterns match what the desktop app uses for this project.
 */
function projectSettingsFor(project: { id: string; path: string; baseRef: string }) {
  const ctx = new LocalExecutionContext({ root: project.path });
  const fs = new LocalFileSystem(project.path);
  const git = new GitService(ctx, fs);
  return new LocalProjectSettingsProvider(project.id, project.path, project.baseRef, { git });
}

/**
 * Real agent dispatcher: resolves the provider config + env the way the app
 * does, then launches the agent in a detached tmux session.
 */
function makeDispatcher(settings: LocalProjectSettingsProvider): CreateAgentDispatcher {
  return async (a) => {
    const providerConfig = await providerOverrideSettings.getItem(a.providerId);
    const providerEnv = resolveProviderEnv(providerConfig, {
      providerId: a.providerId,
      autoApprove: a.autoApprove,
    });
    const env = buildAgentEnv({ providerVars: providerEnv });
    const shellSetup = await settings
      .get()
      .then((s) => s.shellSetup)
      .catch(() => undefined);
    return dispatchAgent({
      projectId: a.projectId,
      taskId: a.taskId,
      conversationId: a.conversationId,
      providerId: a.providerId,
      providerConfig,
      autoApprove: a.autoApprove,
      prompt: a.prompt,
      cwd: a.cwd,
      env,
      shellSetup,
    });
  };
}

/** Returns the process exit code: 0 normally, 1 if a requested prompt wasn't delivered. */
async function runCreate(args: ParsedArgs): Promise<number> {
  const projectArg = getString(args, 'project');
  if (!projectArg) throw new Error('--project <name|id> is required.');

  const strategy: WorkspaceStrategy = getBool(args, 'no-worktree')
    ? 'no-worktree'
    : getBool(args, 'checkout-existing')
      ? 'checkout-existing'
      : 'new-branch';

  const project = await resolveProject(db, projectArg);
  const settings = projectSettingsFor(project);
  const prompt = getString(args, 'prompt');

  const result = await createWorkspace(db, {
    project,
    branch: getString(args, 'branch'),
    base: getString(args, 'base'),
    name: getString(args, 'name'),
    strategy,
    settings,
    pushBranch: getBool(args, 'push-branch'),
    prompt,
    agent: getString(args, 'agent'),
    autoApprove: getBool(args, 'auto-approve'),
    dispatch: makeDispatcher(settings),
  });

  // Fail-closed: a requested prompt that wasn't delivered is an error.
  const promptFailed = Boolean(prompt) && result.promptDelivered !== true;

  if (getBool(args, 'json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return promptFailed ? 1 : 0;
  }

  const verb = result.reused ? 'Reused existing workspace' : 'Created workspace';
  process.stdout.write(`${verb} ${result.workspaceId}\n`);
  process.stdout.write(`  task:    ${result.taskId}\n`);
  if (result.branch) process.stdout.write(`  branch:  ${result.branch}\n`);
  process.stdout.write(`  path:    ${result.path}\n`);
  if (result.pushed !== undefined) {
    process.stdout.write(`  pushed:  ${result.pushed ? 'yes' : 'no'}\n`);
  }
  if (result.agent) {
    process.stdout.write(`  agent:   ${result.agent} (conversation ${result.conversationId})\n`);
    process.stdout.write(`  prompt:  ${result.promptDelivered ? 'delivered' : 'NOT delivered'}\n`);
  }
  if (result.warning) {
    process.stderr.write(`Warning: ${result.warning}\n`);
  }
  if (promptFailed) {
    process.stderr.write(
      'Prompt was not delivered (agent may use keystroke injection, or tmux mode is off / no session). ' +
        'Try `emdash workspace send` once the agent is up.\n'
    );
  }
  return promptFailed ? 1 : 0;
}

async function runRemove(args: ParsedArgs): Promise<void> {
  const projectArg = getString(args, 'project');
  if (!projectArg) throw new Error('--project <name|id> is required.');

  const project = await resolveProject(db, projectArg);
  const settings = projectSettingsFor(project);

  const result = await removeWorkspace(db, {
    project,
    branch: getString(args, 'branch'),
    id: getString(args, 'id'),
    preRemoveCmd: getString(args, 'pre-remove') ?? process.env.EMDASH_PRE_REMOVE,
    skipHook: getBool(args, 'skip-hook'),
    force: getBool(args, 'force'),
    settings,
  });

  if (getBool(args, 'json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.alreadyGone) {
    process.stdout.write('Nothing to remove (already torn down).\n');
    return;
  }
  process.stdout.write(`Removed workspace ${result.workspaceId}\n`);
  if (result.branch) process.stdout.write(`  branch:    ${result.branch}\n`);
  if (result.hookRan) process.stdout.write('  hook:      ran\n');
  process.stdout.write(`  worktree:  ${result.removedWorktree ? 'removed' : 'skipped'}\n`);
  process.stdout.write(`  branch rm: ${result.removedBranch ? 'yes' : 'no'}\n`);
  if (result.branchRetained === 'unmerged') {
    process.stdout.write(
      `  note:      branch "${result.branch}" kept (has unmerged commits); re-run with --force to delete it\n`
    );
  }
  process.stdout.write(`  tasks:     ${result.deletedTasks} deleted\n`);
}

/** Returns the process exit code: 0 when delivered, 1 otherwise. */
async function runSend(args: ParsedArgs): Promise<number> {
  const projectArg = getString(args, 'project');
  if (!projectArg) throw new Error('--project <name|id> is required.');
  const message = getString(args, 'message');
  if (!message) throw new Error('--message "<text>" is required.');

  const project = await resolveProject(db, projectArg);
  const result = await sendToWorkspace(db, {
    project,
    branch: getString(args, 'branch'),
    id: getString(args, 'id'),
    conversationId: getString(args, 'conversation'),
    message,
  });

  if (getBool(args, 'json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.delivered ? 0 : 1;
  }

  if (result.delivered) {
    process.stdout.write(`Delivered to ${result.tmuxSession}\n`);
    return 0;
  }
  const hint =
    result.reason === 'no-active-session'
      ? ' (no live tmux session — is tmux mode enabled for this project and the agent running?)'
      : '';
  process.stderr.write(`Not delivered: ${result.reason}${hint}\n`);
  return 1;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [group, command] = args.positionals;

  if (getBool(args, 'help') || !group) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (group !== 'workspace') {
    process.stderr.write(`Unknown command group: ${group}\n\n${USAGE}`);
    return 1;
  }

  try {
    switch (command) {
      case 'list':
        await runList(args);
        return 0;
      case 'create':
        return await runCreate(args);
      case 'remove':
        await runRemove(args);
        return 0;
      case 'send':
        return await runSend(args);
      default:
        process.stderr.write(`Unknown workspace command: ${command ?? '(none)'}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
