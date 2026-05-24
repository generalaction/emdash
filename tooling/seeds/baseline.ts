import type { AppDb } from '@main/db/client';
import { conversations, projectRemotes, projects, projectSettings, tasks } from '@main/db/schema';
import type { Branch } from '@shared/git';

const mainBranch: Branch = { type: 'local', branch: 'main' };

// Fixed UUIDs so fixture content is stable across regenerations.
const PROJECT_A_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_B_ID = '22222222-2222-2222-2222-222222222222';

const TASK_A1_ID = 'aaaa0001-0000-0000-0000-000000000000';
const TASK_A2_ID = 'aaaa0002-0000-0000-0000-000000000000';
const TASK_A3_ID = 'aaaa0003-0000-0000-0000-000000000000';
const TASK_B1_ID = 'bbbb0001-0000-0000-0000-000000000000';

const CONV_A1_ID = 'cccc0001-0000-0000-0000-000000000000';
const CONV_A2_ID = 'cccc0002-0000-0000-0000-000000000000';

/**
 * Realistic but fully synthetic dataset — no sensitive data.
 * Represents a developer's day-to-day emdash state: two projects,
 * four tasks across various lifecycle statuses, and a couple of conversations.
 */
export async function baseline(db: AppDb): Promise<void> {
  await db.insert(projects).values([
    {
      id: PROJECT_A_ID,
      name: 'emdash',
      path: '/home/dev/projects/emdash',
      workspaceProvider: 'local',
      baseRef: 'main',
    },
    {
      id: PROJECT_B_ID,
      name: 'my-api',
      path: '/home/dev/projects/my-api',
      workspaceProvider: 'local',
      baseRef: 'main',
    },
  ]);

  await db.insert(projectRemotes).values([
    {
      projectId: PROJECT_A_ID,
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/emdash.git',
    },
    {
      projectId: PROJECT_B_ID,
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/my-api.git',
    },
  ]);

  await db
    .insert(projectSettings)
    .values([{ projectId: PROJECT_A_ID }, { projectId: PROJECT_B_ID }]);

  await db.insert(tasks).values([
    {
      id: TASK_A1_ID,
      projectId: PROJECT_A_ID,
      name: 'Add workspace database entity',
      status: 'in_progress',
      taskBranch: 'feat/workspace-db',
      sourceBranch: mainBranch,
      workspaceId: `local:${PROJECT_A_ID}:branch:feat/workspace-db`,
    },
    {
      id: TASK_A2_ID,
      projectId: PROJECT_A_ID,
      name: 'Improve migration test tooling',
      status: 'review',
      taskBranch: 'feat/migration-testing',
      sourceBranch: mainBranch,
      workspaceId: `local:${PROJECT_A_ID}:branch:feat/migration-testing`,
    },
    {
      id: TASK_A3_ID,
      projectId: PROJECT_A_ID,
      name: 'Fix SSH connection timeout',
      status: 'done',
      taskBranch: 'fix/ssh-timeout',
      sourceBranch: mainBranch,
      archivedAt: '2026-04-01T10:00:00.000Z',
      workspaceId: `local:${PROJECT_A_ID}:branch:fix/ssh-timeout`,
    },
    {
      id: TASK_B1_ID,
      projectId: PROJECT_B_ID,
      name: 'Add rate limiting middleware',
      status: 'todo',
      taskBranch: 'feat/rate-limiting',
      sourceBranch: mainBranch,
    },
  ]);

  await db.insert(conversations).values([
    {
      id: CONV_A1_ID,
      projectId: PROJECT_A_ID,
      taskId: TASK_A1_ID,
      title: 'Plan workspace schema',
      provider: 'anthropic',
      isInitialConversation: true,
    },
    {
      id: CONV_A2_ID,
      projectId: PROJECT_A_ID,
      taskId: TASK_A2_ID,
      title: 'Design fixture tooling',
      provider: 'anthropic',
      isInitialConversation: true,
    },
  ]);
}
