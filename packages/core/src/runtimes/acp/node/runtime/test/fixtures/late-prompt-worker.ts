// Subprocess fixture: runs the ACP runtime under Node's default unhandled-rejection policy, which
// terminates this process the same way it terminates the shared production ACP worker.
import type { PromptRequest, PromptResponse } from '@agentclientprotocol/sdk';
import { deferred } from '@emdash/shared/testing';
import { makeAcpHarness, makeStartInput } from '../../../acp-test-support';
import { AcpRuntime } from '../../runtime';

const h = makeAcpHarness();
const victimPrompted = deferred<void>();
const victimTurn = deferred<PromptResponse>();
h.agent.newSession
  .mockResolvedValueOnce({ sessionId: 'sibling-session' })
  .mockResolvedValueOnce({ sessionId: 'victim-session' });
h.agent.prompt.mockImplementation(async ({ sessionId }: PromptRequest) => {
  if (sessionId !== 'victim-session') return { stopReason: 'end_turn' };
  victimPrompted.resolve();
  return victimTurn.promise;
});

const rt = new AcpRuntime(h.deps);
await rt.startSession(makeStartInput({ conversationId: 'sibling' }), 'resume');
await rt.startSession(
  makeStartInput({ conversationId: 'victim', initialQueue: [{ text: 'long turn' }] }),
  'resume'
);
await victimPrompted.promise;
await rt.terminateSession('victim');
victimTurn.resolve({ stopReason: 'cancelled' });
await new Promise((resolve) => setImmediate(resolve));

await rt.sendPrompt('sibling', { text: 'still there?' });
while (rt.getSessionState('sibling').isGenerating) {
  await new Promise((resolve) => setImmediate(resolve));
}
process.stdout.write(
  JSON.stringify({
    unhandledRejectionListeners: process.listenerCount('unhandledRejection'),
    siblingStopReason: rt.getSessionState('sibling').lastStopReason,
  })
);
await rt.dispose();
