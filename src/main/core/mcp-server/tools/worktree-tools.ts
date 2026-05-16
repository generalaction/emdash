/**
 * Registers the `worktree.*` MCP tools.
 *
 * Lower-level than `task.openInIDE`: resolves a workspace path directly from
 * the `workspace-registry` and delegates to `appService.openIn`.
 *
 *   worktree.openInIDE → `workspaceRegistry.get` + `appService.openIn`
 *
 * The editor enum + mapping is shared with `task-tools.ts` via `_helpers.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { appService as AppService } from '@main/core/app/service';
import type { workspaceRegistry as WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { editorSchema, editorToOpenInAppId, formatErr, formatOk, withRecording } from './_helpers';

// ─── Lazy deps ────────────────────────────────────────────────────────────

type WorktreeDeps = {
  workspaceRegistry: typeof WorkspaceRegistry;
  appService: typeof AppService;
};

let cachedDeps: WorktreeDeps | null = null;
let cachedDepsPromise: Promise<WorktreeDeps> | null = null;

async function loadDeps(): Promise<WorktreeDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const [workspaceMod, appMod] = await Promise.all([
      import('@main/core/workspaces/workspace-registry'),
      import('@main/core/app/service'),
    ]);
    cachedDeps = {
      workspaceRegistry: workspaceMod.workspaceRegistry,
      appService: appMod.appService,
    };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — for tests: inject a ready-made deps object. */
export function _setWorktreeDeps(deps: WorktreeDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — for tests: clear cached deps. */
export function _resetWorktreeDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

// ─── Tool registration ────────────────────────────────────────────────────

export function registerWorktreeTools(server: McpServer): void {
  const openInIdeInput = {
    workspaceId: z.string(),
    editor: editorSchema,
  };
  server.registerTool(
    'worktree.openInIDE',
    {
      title: 'Open workspace in editor',
      description:
        'Open a workspace path directly in the requested editor ' +
        '(vscode | cursor | zed | sublime | terminal). Lower-level than ' +
        'task.openInIDE — operates on raw workspace IDs.',
      inputSchema: openInIdeInput,
    },
    withRecording(
      'worktree.openInIDE',
      async (args: z.infer<z.ZodObject<typeof openInIdeInput>>) => {
        const deps = await loadDeps();
        const ws = deps.workspaceRegistry.get(args.workspaceId);
        if (!ws) {
          return formatErr(
            'WORKSPACE_NOT_READY',
            'Workspace is not currently mounted; provision its task first.',
            { workspaceId: args.workspaceId }
          );
        }
        const appId = editorToOpenInAppId[args.editor];
        await deps.appService.openIn({ app: appId, path: ws.path });
        return formatOk({ workspaceId: args.workspaceId, editor: args.editor, path: ws.path });
      }
    ) as never
  );
}

export { registerWorktreeTools as register };
