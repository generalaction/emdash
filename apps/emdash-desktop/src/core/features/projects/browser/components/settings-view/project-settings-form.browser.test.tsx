import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => undefined,
}));
vi.mock('./project-settings-footer', () => ({
  ProjectSettingsFooter: () => null,
}));
vi.mock('./sections/base-project-settings-section', () => ({
  BaseProjectSettingsSection: () => null,
}));
vi.mock('./sections/shareable-project-settings-section', () => ({
  ShareableSettingsSection: () => null,
}));
vi.mock('./use-project-settings-form', () => ({
  useProjectSettingsForm: () => ({
    form: {
      gitIdentity: {},
      placement: {},
      lifecycle: {},
      fileHandling: {},
    },
    configMigrations: [],
  }),
}));

const { ProjectSettingsForm } = await import('./project-settings-form');

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectSettingsForm unavailable copy', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each([
    [
      'local',
      'Repository-backed settings may be out of date while the local runtime is unavailable.',
    ],
    [
      'ssh',
      'Repository-backed settings may be out of date while this Project’s Machine is unavailable.',
    ],
  ] as const)('uses %s runtime terminology for stale observations', async (projectType, copy) => {
    await renderForm(root, projectType, 'stale');

    expect(host.textContent).toContain(copy);
    expect(host.textContent).not.toContain('Host-derived');
  });

  it.each([
    ['local', 'Repository-backed settings are unavailable until the local runtime is ready.'],
    ['ssh', 'Repository-backed settings are unavailable until this Project’s Machine is ready.'],
  ] as const)('uses %s runtime terminology when never observed', async (projectType, copy) => {
    await renderForm(root, projectType, 'unavailable');

    expect(host.textContent).toContain(copy);
  });

  it('lets the Project page own vertical scrolling', async () => {
    await renderForm(root, 'local', 'unavailable');

    expect(host.querySelector('.overflow-y-auto')).toBeNull();
  });
});

async function renderForm(
  root: Root,
  projectType: 'local' | 'ssh',
  hostObservationKind: 'stale' | 'unavailable'
): Promise<void> {
  await act(async () => {
    root.render(
      <ProjectSettingsForm
        projectId="project-1"
        projectType={projectType}
        domains={{} as never}
        configMigrations={[]}
        hostActionReason={null}
        hostObservationKind={hostObservationKind}
        onSuccess={vi.fn()}
        save={vi.fn()}
        writeConfigToRepo={vi.fn()}
        migrateProjectConfig={vi.fn()}
      />
    );
  });
}
