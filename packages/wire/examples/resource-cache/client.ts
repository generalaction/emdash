import { createResourceCache } from '../../src/util';

type Session = {
  id: string;
  generation: number;
  stop(): void;
};

async function main(): Promise<void> {
  let generation = 0;
  const stopped: string[] = [];
  const sessions = createResourceCache({
    key: (key: { id: string }) => key.id,
    idleTtlMs: 20,
    create: async ({ id }, scope): Promise<Session> => {
      generation += 1;
      const sessionGeneration = generation;
      const session = {
        id,
        generation: sessionGeneration,
        stop: () => stopped.push(`${id}:${sessionGeneration}`),
      };
      scope.add(() => {
        session.stop();
      });
      console.log('created:', session);
      return session;
    },
  });

  const first = sessions.acquire({ id: 'conversation-one' });
  const second = sessions.acquire({ id: 'conversation-one' });
  const firstValue = await first.ready();
  const secondValue = await second.ready();

  console.log('shared in-flight:', firstValue === secondValue);
  await first.release();
  await second.release();

  const reused = sessions.acquire({ id: 'conversation-one' });
  console.log('reused during idle ttl:', (await reused.ready()) === firstValue);
  await reused.release();

  await delay(25);
  console.log('stopped:', stopped);

  const recreated = sessions.acquire({ id: 'conversation-one' });
  console.log('recreated generation:', (await recreated.ready()).generation);
  await recreated.release();
  await sessions.dispose();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
