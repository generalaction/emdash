import { describe, expect, it, vi } from 'vitest';
import { createMailbox, MailboxClosedError, MailboxConsumerError } from './mailbox';
import { createScope } from './scope';

describe('createMailbox', () => {
  it('delivers accepted values in FIFO order', async () => {
    const mailbox = createMailbox<number>({ capacity: 3 });

    expect(mailbox.tryOffer(1)).toEqual({ kind: 'accepted' });
    expect(await mailbox.offer(2)).toEqual({ kind: 'accepted' });
    expect(await mailbox.offer(3)).toEqual({ kind: 'accepted' });

    await expect(mailbox.take()).resolves.toBe(1);
    await expect(mailbox.take()).resolves.toBe(2);
    await expect(mailbox.take()).resolves.toBe(3);
  });

  it('hands an offered value directly to a waiting taker', async () => {
    const mailbox = createMailbox<string>({ capacity: 1 });
    const taken = mailbox.take();

    expect(mailbox.tryOffer('ready')).toEqual({ kind: 'accepted' });

    await expect(taken).resolves.toBe('ready');
    expect(mailbox.size).toBe(0);
  });

  it('suspends producers at capacity and accepts them FIFO as space opens', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    mailbox.tryOffer(0);

    const firstOffer = mailbox.offer(1);
    const secondOffer = mailbox.offer(2);
    let firstSettled = false;
    firstOffer.then(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    await expect(mailbox.take()).resolves.toBe(0);
    await expect(firstOffer).resolves.toEqual({ kind: 'accepted' });
    await expect(mailbox.take()).resolves.toBe(1);
    await expect(secondOffer).resolves.toEqual({ kind: 'accepted' });
    await expect(mailbox.take()).resolves.toBe(2);
  });

  it('supports reject overflow', async () => {
    const mailbox = createMailbox<number>({ capacity: 1, overflow: 'reject' });

    expect(mailbox.tryOffer(1)).toEqual({ kind: 'accepted' });
    expect(mailbox.tryOffer(2)).toEqual({ kind: 'full' });
    await expect(mailbox.offer(3)).resolves.toEqual({ kind: 'full' });
    await expect(mailbox.take()).resolves.toBe(1);
  });

  it('supports drop-oldest overflow', async () => {
    const onDrop = vi.fn();
    const mailbox = createMailbox<number>({ capacity: 2, overflow: 'drop-oldest', onDrop });

    mailbox.tryOffer(1);
    mailbox.tryOffer(2);
    expect(mailbox.tryOffer(3)).toEqual({ kind: 'accepted', dropped: 1 });

    expect(onDrop).toHaveBeenCalledWith(1);
    await expect(mailbox.take()).resolves.toBe(2);
    await expect(mailbox.take()).resolves.toBe(3);
  });

  it('supports drop-newest overflow', async () => {
    const onDrop = vi.fn();
    const mailbox = createMailbox<number>({ capacity: 1, overflow: 'drop-newest', onDrop });

    mailbox.tryOffer(1);
    expect(mailbox.tryOffer(2)).toEqual({ kind: 'dropped', value: 2 });

    expect(onDrop).toHaveBeenCalledWith(2);
    await expect(mailbox.take()).resolves.toBe(1);
  });

  it('closes gracefully after buffered values drain', async () => {
    const mailbox = createMailbox<number>({ capacity: 2 });
    mailbox.tryOffer(1);
    mailbox.tryOffer(2);

    mailbox.close();

    expect(mailbox.state).toBe('closing');
    await expect(mailbox.take()).resolves.toBe(1);
    await expect(mailbox.take()).resolves.toBe(2);
    expect(mailbox.state).toBe('closed');
    await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxClosedError);
  });

  it('fails after buffered values drain', async () => {
    const error = new Error('boom');
    const mailbox = createMailbox<number>({ capacity: 1 });
    mailbox.tryOffer(1);

    mailbox.fail(error);

    await expect(mailbox.take()).resolves.toBe(1);
    await expect(mailbox.take()).rejects.toBe(error);
  });

  it('dispose clears buffered values and unblocks waiters immediately', async () => {
    const mailbox = createMailbox<number>({ capacity: 2 });
    mailbox.tryOffer(1);

    mailbox.dispose();

    expect(mailbox.size).toBe(0);
    expect(mailbox.tryTake()).toBeUndefined();
    expect(mailbox.tryOffer(3)).toEqual({ kind: 'closed' });
  });

  it('dispose rejects a pending take', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const pending = mailbox.take();

    mailbox.dispose();

    await expect(pending).rejects.toBeInstanceOf(MailboxClosedError);
  });

  it('aborts one pending take without closing the mailbox', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const controller = new AbortController();
    const take = mailbox.take({ signal: controller.signal });

    controller.abort(new Error('aborted'));

    await expect(take).rejects.toThrow('aborted');
    expect(mailbox.state).toBe('open');
    mailbox.tryOffer(1);
    await expect(mailbox.take()).resolves.toBe(1);
  });

  it('aborts one suspended offer without closing the mailbox', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const controller = new AbortController();
    mailbox.tryOffer(1);
    const offer = mailbox.offer(2, { signal: controller.signal });

    controller.abort(new Error('aborted'));

    await expect(offer).rejects.toThrow('aborted');
    await expect(mailbox.take()).resolves.toBe(1);
    expect(mailbox.state).toBe('open');
  });

  it('rejects concurrent pending takes', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const first = mailbox.take();

    await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxConsumerError);
    mailbox.tryOffer(1);
    await expect(first).resolves.toBe(1);
  });

  it('iterates until close', async () => {
    const mailbox = createMailbox<number>({ capacity: 3 });
    mailbox.tryOffer(1);
    mailbox.tryOffer(2);
    mailbox.close();

    const seen: number[] = [];
    for await (const value of mailbox) {
      seen.push(value);
    }

    expect(seen).toEqual([1, 2]);
  });

  it('prevents external takes while an iterator is active', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const iterator = mailbox[Symbol.asyncIterator]();
    const next = iterator.next();

    await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxConsumerError);
    mailbox.tryOffer(1);
    await expect(next).resolves.toEqual({ done: false, value: 1 });
    await iterator.return?.();
  });

  it('releases the active iterator flag after early return', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const iterator = mailbox[Symbol.asyncIterator]();
    mailbox.tryOffer(1);

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    await iterator.return?.();

    expect(mailbox.state).toBe('open');
    mailbox.tryOffer(2);
    await expect(mailbox.take()).resolves.toBe(2);
  });

  it('closes when its owning scope is disposed', async () => {
    const scope = createScope();
    const mailbox = scope.use(createMailbox<number>({ capacity: 1 }));
    const pending = mailbox.take();

    await scope.dispose();

    await expect(pending).rejects.toBeInstanceOf(MailboxClosedError);
    expect(mailbox.state).toBe('closed');
  });

  it('returns closed for suspended offers when closed', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    mailbox.tryOffer(1);
    const offered = mailbox.offer(2);

    mailbox.close();

    await expect(offered).resolves.toEqual({ kind: 'closed' });
    await expect(mailbox.take()).resolves.toBe(1);
    await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxClosedError);
  });

  it('is idempotent for terminal operations', async () => {
    const mailbox = createMailbox<number>({ capacity: 1 });
    const take = mailbox.take();

    mailbox.close();
    mailbox.close();
    mailbox.fail(new Error('ignored'));
    mailbox.dispose();
    mailbox.dispose();

    await expect(take).rejects.toBeInstanceOf(MailboxClosedError);
  });
});
