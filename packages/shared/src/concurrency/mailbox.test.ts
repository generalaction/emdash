import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { createMailbox, MailboxClosedError, MailboxConsumerError } from './mailbox';

describe('createMailbox', () => {
  it('delivers offered values to takers in FIFO order', async () => {
    const mailbox = createMailbox<string>({ capacity: 2 });

    expect(mailbox.tryOffer('a')).toEqual({ kind: 'accepted' });
    expect(mailbox.tryOffer('b')).toEqual({ kind: 'accepted' });

    await expect(mailbox.take()).resolves.toBe('a');
    await expect(mailbox.take()).resolves.toBe('b');
  });

  it('hands an offer directly to a suspended take', async () => {
    const mailbox = createMailbox<string>({ capacity: 1 });
    const take = mailbox.take();

    expect(mailbox.tryOffer('a')).toEqual({ kind: 'accepted' });
    await expect(take).resolves.toBe('a');
    expect(mailbox.size).toBe(0);
  });

  it('suspends offer when full and resumes it after a take', async () => {
    const mailbox = createMailbox<string>({ capacity: 1 });
    expect(mailbox.tryOffer('a')).toEqual({ kind: 'accepted' });

    let offerSettled = false;
    const offer = mailbox.offer('b').then((result) => {
      offerSettled = true;
      return result;
    });

    await Promise.resolve();
    expect(offerSettled).toBe(false);

    await expect(mailbox.take()).resolves.toBe('a');
    await expect(offer).resolves.toEqual({ kind: 'accepted' });
    await expect(mailbox.take()).resolves.toBe('b');
  });

  it('rejects a suspended offer when its signal aborts and removes it from the queue', async () => {
    const mailbox = createMailbox<string>({ capacity: 1 });
    mailbox.tryOffer('a');
    const controller = new AbortController();
    const offer = mailbox.offer('b', { signal: controller.signal });

    controller.abort(new Error('offer cancelled'));
    await expect(offer).rejects.toThrow('offer cancelled');

    // The aborted offer must not be delivered after space frees up.
    await expect(mailbox.take()).resolves.toBe('a');
    expect(mailbox.tryTake()).toBeUndefined();
  });

  it('rejects a pending take when its signal aborts', async () => {
    const mailbox = createMailbox<string>({ capacity: 1 });
    const controller = new AbortController();
    const take = mailbox.take({ signal: controller.signal });

    controller.abort(new Error('take cancelled'));
    await expect(take).rejects.toThrow('take cancelled');

    // The mailbox accepts a new take afterwards.
    mailbox.tryOffer('a');
    await expect(mailbox.take()).resolves.toBe('a');
  });

  describe('ownership loss contract', () => {
    it('fires onDrop for values evicted by drop-oldest overflow', () => {
      const onDrop = vi.fn();
      const mailbox = createMailbox<string>({ capacity: 1, overflow: 'drop-oldest', onDrop });

      mailbox.tryOffer('a');
      expect(mailbox.tryOffer('b')).toEqual({ kind: 'accepted', dropped: 'a' });

      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith('a');
    });

    it('fires onDrop for values discarded by drop-newest overflow', () => {
      const onDrop = vi.fn();
      const mailbox = createMailbox<string>({ capacity: 1, overflow: 'drop-newest', onDrop });

      mailbox.tryOffer('a');
      expect(mailbox.tryOffer('b')).toEqual({ kind: 'dropped', value: 'b' });

      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith('b');
    });

    it('never fires onDrop when reject overflow reports full', () => {
      const onDrop = vi.fn();
      const mailbox = createMailbox<string>({ capacity: 1, overflow: 'reject', onDrop });

      mailbox.tryOffer('a');
      expect(mailbox.tryOffer('b')).toEqual({ kind: 'full' });

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('drains buffered values through onDrop on dispose()', () => {
      const onDrop = vi.fn();
      const mailbox = createMailbox<string>({ capacity: 3, onDrop });

      mailbox.tryOffer('a');
      mailbox.tryOffer('b');
      mailbox.dispose();

      expect(onDrop).toHaveBeenCalledTimes(2);
      expect(onDrop.mock.calls.map(([value]) => value)).toEqual(['a', 'b']);
      expect(mailbox.state).toBe('closed');
    });

    it('resolves suspended offers as closed on dispose without firing onDrop for them', async () => {
      const onDrop = vi.fn();
      const mailbox = createMailbox<string>({ capacity: 1, onDrop });

      mailbox.tryOffer('a');
      const offer = mailbox.offer('b');
      mailbox.dispose();

      await expect(offer).resolves.toEqual({ kind: 'closed' });
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith('a');
    });
  });

  describe('offer(undefined)', () => {
    it('throws from tryOffer with a clear message', () => {
      const mailbox = createMailbox<string | undefined>({ capacity: 1 });
      expect(() => mailbox.tryOffer(undefined)).toThrow(/undefined/);
    });

    it('rejects from offer with a clear message', async () => {
      const mailbox = createMailbox<string | undefined>({ capacity: 1 });
      await expect(mailbox.offer(undefined)).rejects.toThrow(/undefined/);
    });
  });

  describe('close and fail', () => {
    it('close() lets buffered values drain before reporting closed', async () => {
      const mailbox = createMailbox<string>({ capacity: 2 });
      mailbox.tryOffer('a');
      mailbox.close();

      expect(mailbox.state).toBe('closing');
      await expect(mailbox.take()).resolves.toBe('a');
      expect(mailbox.state).toBe('closed');
      await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxClosedError);
    });

    it('fail() rejects takes with the failure once the buffer is drained', async () => {
      const mailbox = createMailbox<string>({ capacity: 2 });
      mailbox.tryOffer('a');
      mailbox.fail(new Error('boom'));

      await expect(mailbox.take()).resolves.toBe('a');
      await expect(mailbox.take()).rejects.toThrow('boom');
    });

    it('dispose() rejects a pending take with MailboxClosedError', async () => {
      const mailbox = createMailbox<string>({ capacity: 1 });
      const take = mailbox.take();
      mailbox.dispose();
      await expect(take).rejects.toBeInstanceOf(MailboxClosedError);
    });
  });

  describe('consumer exclusivity', () => {
    it('rejects a second concurrent take', async () => {
      const mailbox = createMailbox<string>({ capacity: 1 });
      const first = mailbox.take();
      await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxConsumerError);
      mailbox.tryOffer('a');
      await expect(first).resolves.toBe('a');
    });

    it('rejects take and tryTake while an iterator is active', async () => {
      const mailbox = createMailbox<string>({ capacity: 2 });
      mailbox.tryOffer('a');

      const gate = deferred<void>();
      const seen: string[] = [];
      const iteration = (async () => {
        for await (const value of mailbox) {
          seen.push(value);
          gate.resolve();
        }
      })();

      await gate.promise;
      await expect(mailbox.take()).rejects.toBeInstanceOf(MailboxConsumerError);
      expect(() => mailbox.tryTake()).toThrow(MailboxConsumerError);

      mailbox.close();
      await iteration;
      expect(seen).toEqual(['a']);
    });
  });
});
