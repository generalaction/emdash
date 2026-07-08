import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  defineContract,
  memoryTransportPair,
  procedure,
  serve,
} from '../../src/index';
import { deduplicateRequests } from '../../src/util';

const api = defineContract({
  expensiveStats: procedure({
    input: z.object({ repo: z.string(), branch: z.string() }),
    output: z.object({ repo: z.string(), branch: z.string(), executions: z.number() }),
  }),
});

async function main(): Promise<void> {
  let executions = 0;
  const pair = memoryTransportPair();
  const controller = bindContract(api, {
    expensiveStats: deduplicateRequests(async (input) => {
      executions += 1;
      const execution = executions;
      await sleep(10);
      return { ...input, executions: execution };
    }),
  });
  serve(pair.right, controller);

  const thin = client(api, connect(pair.left));
  const [first, second, third] = await Promise.all([
    thin.expensiveStats({ repo: 'emdash', branch: 'main' }),
    thin.expensiveStats({ branch: 'main', repo: 'emdash' }),
    thin.expensiveStats({ repo: 'emdash', branch: 'feature' }),
  ]);

  console.log('first:', first);
  console.log('second:', second);
  console.log('third:', third);
  console.log('handler executions:', executions);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
