import { observable, runInAction } from 'mobx';
import { beforeEach, expect, it, vi } from 'vitest';
import { FlutterRunner } from './flutter-runner';

const sendInput = vi.fn(async (_input: unknown) => ({ success: true }));
vi.mock('@core/features/terminals/api/browser/client', () => ({
  getTerminalsClient: async () => ({ sendInput }),
}));

beforeEach(() => sendInput.mockClear());

function runnerWithTerminal() {
  const terminals = observable.map<string, unknown>([['flutter', {}]]);
  const runner = new FlutterRunner(
    'project',
    'task',
    'workspace',
    { terminals } as never,
    { servers: [] } as never
  );
  Object.assign(runner, { terminalId: 'flutter', key: { terminalId: 'flutter' } });
  return { runner, terminals };
}

it('types nothing into the shell while flutter run owns it', async () => {
  const { runner } = runnerWithTerminal();
  runInAction(() => (runner.phase = 'running'));
  await runner.refreshTargets();
  await expect(
    runner.selectTarget({
      kind: 'emulator',
      emulator: { id: 'e', name: 'E', platform: 'android' },
    })
  ).rejects.toThrow('Stop the app');
  expect(sendInput).not.toHaveBeenCalled();
});

it('ends a pending command when the Flutter terminal closes', async () => {
  const { runner, terminals } = runnerWithTerminal();
  const refresh = runner.refreshTargets();
  await vi.waitFor(() => expect(sendInput).toHaveBeenCalled());
  expect(runner.phase).toBe('busy');
  runInAction(() => terminals.delete('flutter'));
  await expect(refresh).rejects.toThrow('Flutter terminal closed');
  expect(runner.phase).toBe('idle');
});
