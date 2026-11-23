// Standalone JavaScript: the global agent directory need not resolve Emdash or engine packages.
export const OMO_EXTENSION_CONTENT = `\
export default function (api) {
  const port = process.env.EMDASH_HOOK_PORT;
  const token = process.env.EMDASH_HOOK_NONCE || process.env.EMDASH_HOOK_TOKEN;
  const ptyId = process.env.EMDASH_PTY_ID;
  if (!port || !/^\\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 ||
      !token || !ptyId) return;

  api.registerFlag('emdash-initial-prompt', { type: 'string' });
  let initialPromptSent = false;
  let delivery = Promise.resolve();
  let active = true;
  let state = 'idle';
  let outcome;
  let previousDeadlineId;
  let prompts = 0;
  function latestDeadline(ctx) {
    return ctx.sessionManager.getEntries().findLast(
      (entry) => entry.type === 'custom' && entry.customType === 'deadline-stop'
    );
  }
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
  api.on('session_start', (event, ctx) => {
    state = 'idle';
    outcome = undefined;
    prompts = 0;
    const sessionFile = ctx.sessionManager.getSessionFile();
    const initialPrompt = api.getFlag('emdash-initial-prompt');
    if (event.reason === 'startup' && !initialPromptSent &&
        typeof initialPrompt === 'string' && initialPrompt) {
      initialPromptSent = true;
      api.sendUserMessage(initialPrompt);
    }
    return sessionFile ? notify('session', { providerSessionId: sessionFile }) : delivery;
  });
  api.on('agent_start', (_event, ctx) => {
    state = 'start';
    outcome = undefined;
    previousDeadlineId = latestDeadline(ctx)?.id;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) notify('session', { providerSessionId: sessionFile });
    return publishState();
  });
  api.on('agent_end', (event, ctx) => {
    const assistant = event.messages.findLast((message) => message.role === 'assistant');
    // The engine records this before aborting, but omits deadline metadata from extension events.
    const deadline = latestDeadline(ctx);
    if (event.abortSource === 'user') {
      outcome = { state: 'idle', userCancelled: true };
    } else if (deadline && deadline.id !== previousDeadlineId) {
      outcome = { state: 'error', message: 'OmO turn deadline exceeded' };
    } else if (assistant?.stopReason === 'error' || event.willRetry) {
      outcome = { state: 'error', message: assistant?.errorMessage };
    } else if (event.aborted || assistant?.stopReason === 'aborted') {
      outcome = { state: 'idle' };
    } else if (assistant) {
      outcome = { state: 'stop' };
    } else {
      outcome = { state: 'error', message: 'OmO settled without a final assistant outcome' };
    }
  });
  api.on('agent_settled', (event) => {
    if (state !== 'start') return delivery;
    const final = outcome?.userCancelled ? outcome : event.fallbackExhausted
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
