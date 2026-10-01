import { expect, it, vi } from 'vitest';
import type { HostTrustRequest } from '@core/services/ssh/api/host-trust';
import { HostTrustPresenter } from './host-trust-presenter';

const request = (id: string): HostTrustRequest => ({
  id,
  prompt: { kind: 'unknown', destination: id, prompt: 'Fingerprint' },
});

it('serializes modals and does not reopen answered requests awaiting a live update', async () => {
  let answer!: (accepted: boolean) => void;
  const show = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      })
  );
  const respond = vi.fn(async () => true);
  const presenter = new HostTrustPresenter(show, respond);
  presenter.update([request('a'), request('b')]);
  expect(show).toHaveBeenCalledTimes(1);
  answer(true);
  await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
  expect(respond).toHaveBeenCalledWith('a', true);
  presenter.update([request('a'), request('b')]);
  answer(false);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith('b', false));
  expect(show).toHaveBeenCalledTimes(2);
  presenter.dispose();
});

it('dismisses canceled prompts and ignores their late approvals', async () => {
  let answer!: (accepted: boolean) => void;
  const show = vi.fn(
    (_prompt, _signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      })
  );
  const respond = vi.fn(async () => true);
  const presenter = new HostTrustPresenter(show, respond);
  presenter.update([request('a')]);
  presenter.update([]);
  expect(show.mock.calls[0][1].aborted).toBe(true);
  answer(true);
  await Promise.resolve();
  expect(respond).not.toHaveBeenCalled();
  presenter.dispose();
});

it('declines the active request when the renderer closes', async () => {
  const respond = vi.fn(async () => true);
  const presenter = new HostTrustPresenter(() => new Promise(() => {}), respond);
  presenter.update([request('a')]);
  presenter.dispose();
  expect(respond).toHaveBeenCalledWith('a', false);
});
