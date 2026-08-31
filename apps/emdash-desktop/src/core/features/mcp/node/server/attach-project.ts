import { err, ok, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { observe, peek } from '@emdash/wire/state';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';

/** Attachment can involve an SSH dial, so allow more than a local open would need. */
const DEFAULT_ATTACH_TIMEOUT_MS = 60_000;

export type AttachedProject = Readonly<{
  project: ProjectProvider;
  /** Releases the tracking lease; always called by {@link withProjectAttachment}. */
  release: () => Promise<void>;
}>;

/**
 * Attaches a project for the duration of one MCP tool call.
 *
 * Attachment is lease-driven: `track` registers an owner and the manager keeps
 * the project attached while at least one owner holds a lease. The renderer's
 * leases come from open views, so a tool call that runs while the project is not
 * on screen has to hold its own.
 */
export async function attachProject(
  projects: ProjectAttachmentManager,
  projectId: string,
  options: { timeoutMs?: number } = {}
): Promise<Result<AttachedProject, string>> {
  const scope = createScope({ label: `mcp-attach-project:${projectId}` });
  const release = () => scope.dispose();

  const state = projects.track(projectId, scope);
  const settled = await new Promise<'attached' | 'failed' | 'timeout'>((resolve) => {
    if (peek(state).kind === 'attached') {
      resolve('attached');
      return;
    }
    const timer = setTimeout(
      () => resolve('timeout'),
      options.timeoutMs ?? DEFAULT_ATTACH_TIMEOUT_MS
    );
    scope.add(() => clearTimeout(timer));
    observe(
      state,
      ({ value }) => {
        // 'absent' is the initial value too, so only a recorded failure makes it
        // terminal; resolving on the bare state would race the first attach.
        if (value.kind === 'attached') resolve('attached');
        else if (value.kind === 'absent' && value.lastFailure) resolve('failed');
      },
      { scope }
    );
  });

  if (settled === 'attached') {
    const attached = projects.requireAttached(projectId);
    if (attached.success) return ok({ project: attached.data, release });
    await release();
    return err(unavailable(projectId, attached.error.type));
  }

  const failure = peek(state);
  const reason =
    failure.kind === 'absent' && failure.lastFailure
      ? failure.lastFailure.type
      : settled === 'timeout'
        ? 'timed out'
        : 'unavailable';
  await release();
  return err(unavailable(projectId, reason));
}

/**
 * Runs `work` with the project attached, releasing the lease afterwards. Unlike
 * `withAttachedProject` in the projects feature, which requires the project to
 * be attached already, this opens it on demand for a headless caller.
 */
export async function withProjectAttachment<T>(
  projects: ProjectAttachmentManager,
  projectId: string,
  work: (project: ProjectProvider) => Promise<Result<T, string>>
): Promise<Result<T, string>> {
  const attached = await attachProject(projects, projectId);
  if (!attached.success) return attached;
  try {
    return await work(attached.data.project);
  } finally {
    await attached.data.release();
  }
}

function unavailable(projectId: string, reason: string): string {
  return `Project ${projectId} could not be opened (${reason})`;
}
