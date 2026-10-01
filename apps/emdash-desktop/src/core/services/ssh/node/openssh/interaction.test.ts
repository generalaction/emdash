import { afterEach, expect, it, vi } from 'vitest';
import { SshInteraction, connectionDeadline } from './interaction';

afterEach(() => vi.useRealTimers());

it('excludes time spent reviewing trust while keeping the remaining connection budget', async () => {
  vi.useFakeTimers();
  const interaction = new SshInteraction();
  const expired = vi.fn();
  const dispose = connectionDeadline(1000, expired, interaction);
  await vi.advanceTimersByTimeAsync(400);
  const resume = interaction.begin();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(expired).not.toHaveBeenCalled();
  resume();
  await vi.advanceTimersByTimeAsync(599);
  expect(expired).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(expired).toHaveBeenCalledOnce();
  dispose();
});

it('handles overlapping prompts and deadlines acquired while already waiting', async () => {
  vi.useFakeTimers();
  const interaction = new SshInteraction();
  const first = interaction.begin();
  const second = interaction.begin();
  const expired = vi.fn();
  const dispose = connectionDeadline(100, expired, interaction);
  first();
  first();
  await vi.advanceTimersByTimeAsync(1000);
  expect(expired).not.toHaveBeenCalled();
  second();
  dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(expired).not.toHaveBeenCalled();
});
