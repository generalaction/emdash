import type { Wire } from '@emdash/core/wire';
import { webContents as electronWebContents } from 'electron';
import { events } from '@main/lib/events';
import { createRPCController, withSender } from '@shared/lib/ipc/rpc';
import { wireEventTopic, wireLiveUpdateChannel } from '@shared/lib/wire/events';

type Unsubscribe = () => void;

export function exposeWire(ns: string, wire: Wire) {
  const upstreamDetach = new Map<string, Unsubscribe>();
  const upstreamAttach = new Map<string, Promise<Unsubscribe>>();
  const refs = new Map<string, Set<number>>();
  const senderTopics = new Map<number, Set<string>>();
  const senderCleanupRegistered = new Set<number>();

  async function liveSubscribe(senderId: number, topic: string): Promise<void> {
    let subscribers = refs.get(topic);
    if (!subscribers) {
      subscribers = new Set();
      refs.set(topic, subscribers);
    }
    subscribers.add(senderId);
    trackSenderTopic(senderId, topic);
    ensureSenderCleanup(senderId);

    if (upstreamDetach.has(topic) || upstreamAttach.has(topic)) return;

    const attach = wire.live.attach(topic, (update) => {
      events.emit(wireLiveUpdateChannel, update, wireEventTopic(ns, topic));
    });
    upstreamAttach.set(topic, attach);

    try {
      const detach = await attach;
      upstreamAttach.delete(topic);
      if ((refs.get(topic)?.size ?? 0) === 0) {
        detach();
      } else {
        upstreamDetach.set(topic, detach);
      }
    } catch (error) {
      upstreamAttach.delete(topic);
      refs.delete(topic);
      untrackSenderTopic(senderId, topic);
      throw error;
    }
  }

  function liveUnsubscribe(senderId: number, topic: string): void {
    const subscribers = refs.get(topic);
    subscribers?.delete(senderId);
    untrackSenderTopic(senderId, topic);

    if ((subscribers?.size ?? 0) > 0) return;
    refs.delete(topic);

    const detach = upstreamDetach.get(topic);
    if (!detach) return;
    upstreamDetach.delete(topic);
    detach();
  }

  function trackSenderTopic(senderId: number, topic: string): void {
    let topics = senderTopics.get(senderId);
    if (!topics) {
      topics = new Set();
      senderTopics.set(senderId, topics);
    }
    topics.add(topic);
  }

  function untrackSenderTopic(senderId: number, topic: string): void {
    const topics = senderTopics.get(senderId);
    topics?.delete(topic);
    if (topics?.size === 0) {
      senderTopics.delete(senderId);
      senderCleanupRegistered.delete(senderId);
    }
  }

  function ensureSenderCleanup(senderId: number): void {
    if (senderCleanupRegistered.has(senderId)) return;
    senderCleanupRegistered.add(senderId);
    const webContents = electronWebContents.fromId(senderId);
    webContents?.once('destroyed', () => {
      const topics = [...(senderTopics.get(senderId) ?? [])];
      for (const topic of topics) {
        liveUnsubscribe(senderId, topic);
      }
      senderTopics.delete(senderId);
      senderCleanupRegistered.delete(senderId);
    });
  }

  return createRPCController({
    call: (path: string, input: unknown) => wire.procedures.call(path, input),
    liveSnapshot: (topic: string) => wire.live.snapshot(topic),
    liveSubscribe: withSender((senderId: number, topic: string) => liveSubscribe(senderId, topic)),
    liveUnsubscribe: withSender((senderId: number, topic: string) => {
      liveUnsubscribe(senderId, topic);
    }),
  });
}
