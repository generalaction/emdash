import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootstrapMain: vi.fn(async () => {}),
  events: [] as string[],
}));

vi.mock('electron', () => ({
  app: {
    commandLine: {},
    isPackaged: false,
    whenReady: vi.fn(async () => {}),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

vi.mock('@main/host/chromium-command-line', () => ({
  configureChromiumCommandLine: vi.fn(() => {
    mocks.events.push('configure-command-line');
  }),
}));

vi.mock('@main/bootstrap', () => {
  mocks.events.push('import-bootstrap');
  return {
    main: mocks.bootstrapMain.mockImplementation(async () => {
      mocks.events.push('run-bootstrap');
    }),
  };
});

beforeEach(() => {
  mocks.bootstrapMain.mockClear();
  mocks.events.length = 0;
});

it('configures Chromium before asynchronously importing bootstrap', async () => {
  await import('./main');
  await vi.waitFor(() => expect(mocks.bootstrapMain).toHaveBeenCalledOnce());

  expect(mocks.events).toEqual(['configure-command-line', 'import-bootstrap', 'run-bootstrap']);
});
