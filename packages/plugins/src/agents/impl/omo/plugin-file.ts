// Standalone JavaScript: the global agent directory need not resolve Emdash or engine packages.
export const OMO_EXTENSION_CONTENT = `\
export default function (api) {
  const port = process.env.EMDASH_HOOK_PORT;
  const token = process.env.EMDASH_HOOK_NONCE || process.env.EMDASH_HOOK_TOKEN;
  const ptyId = process.env.EMDASH_PTY_ID;
  if (!port || !/^\\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 ||
      !token || !ptyId) return;

  let delivery = Promise.resolve();
  let active = true;
  let state = 'idle';
  let outcome;
  let prompts = 0;
  function notify(eventType, body = {}) {
    if (!active) return delivery;
    delivery = delivery.then(async () => {
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/hook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Emdash-Token': token,
            'X-Emdash-Pty-Id': ptyId,
            'X-Emdash-Event-Type': eventType,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
      } catch {
        // Best-effort transport boundary: Emdash may have closed; never retry or fail the agent.
      }
    });
    return delivery;
  }
  function publishState() {
    if (prompts > 0) {
      return notify('notification', { notification_type: 'elicitation_dialog' });
    }
    return notify(state === 'idle' || state === 'stop' ? 'notification' : state);
  }
  api.on('session_start', (_event, ctx) => {
    state = 'idle';
    outcome = undefined;
    prompts = 0;
    const sessionFile = ctx.sessionManager.getSessionFile();
    return sessionFile ? notify('session', { providerSessionId: sessionFile }) : delivery;
  });
  api.on('agent_start', (_event, ctx) => {
    state = 'start';
    outcome = undefined;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) notify('session', { providerSessionId: sessionFile });
    return publishState();
  });
  api.on('agent_end', (event) => {
    const assistant = event.messages.findLast((message) => message.role === 'assistant');
    if (event.abortSource === 'user' || (event.aborted && !event.willRetry)) {
      outcome = { state: 'idle' };
    } else if (assistant?.stopReason === 'error' || event.willRetry) {
      outcome = { state: 'error', message: assistant?.errorMessage };
    } else if (assistant?.stopReason === 'aborted') {
      outcome = { state: 'idle' };
    } else if (assistant) {
      outcome = { state: 'stop' };
    } else {
      outcome = { state: 'error', message: 'OmO settled without a final assistant outcome' };
    }
  });
  api.on('agent_settled', (event) => {
    if (state !== 'start') return delivery;
    const final = outcome?.state === 'idle' ? outcome : event.fallbackExhausted
      ? { state: 'error', message: 'OmO exhausted all fallback models' }
      : outcome || { state: 'error', message: 'OmO settled without an agent outcome' };
    state = final.state;
    prompts = 0;
    return notify(state === 'idle' ? 'notification' : state,
      final.message ? { message: final.message } : {});
  });
  api.on('session_abort', () => {
    state = 'idle';
    outcome = { state: 'idle' };
    prompts = 0;
    return publishState();
  });
  api.on('ui_prompt_start', () => {
    prompts += 1;
    return publishState();
  });
  api.on('ui_prompt_end', () => {
    if (prompts === 0) return delivery;
    prompts -= 1;
    return publishState();
  });
  api.on('session_shutdown', () => {
    active = false;
    return delivery;
  });
}
`;
