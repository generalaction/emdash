export const AMP_ACP_ADAPTER_SCRIPT = String.raw`
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const sessions = new Map();
let nextSessionCounter = 0;

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respond(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function fail(id, error) {
  write({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

function notifySessionUpdate(sessionId, update) {
  write({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update },
  });
}

function effortLevelsForModel(model) {
  if (model === 'deep') return ['low', 'medium', 'xhigh'];
  if (model === 'smart') return ['high', 'xhigh', 'max'];
  return [];
}

function defaultEffortForModel(model) {
  return model === 'deep' ? 'medium' : 'high';
}

function buildConfigOptions(session) {
  const options = [
    {
      type: 'select',
      id: 'permission',
      name: 'Permissions',
      description: 'Controls whether Amp uses configured permissions or force-allows tool calls.',
      category: 'mode',
      currentValue: session.permission,
      options: [
        { value: 'default', name: 'Default' },
        { value: 'bypass', name: 'Bypass' },
      ],
    },
    {
      type: 'select',
      id: 'amp-mode',
      name: 'Amp Mode',
      description: 'Select the Amp execution mode.',
      category: 'model',
      currentValue: session.model,
      options: [
        { value: 'smart', name: 'Smart' },
        { value: 'deep', name: 'Deep' },
        { value: 'rush', name: 'Rush' },
      ],
    },
  ];
  const efforts = effortLevelsForModel(session.model);
  if (efforts.length > 0) {
    options.push({
      type: 'select',
      id: 'effort',
      name: 'Effort',
      description: 'Set Amp reasoning effort.',
      category: 'thought_level',
      currentValue: session.effort,
      options: efforts.map((value) => ({ value, name: value })),
    });
  }
  return options;
}

function newSession(params) {
  const sessionId = 'S-' + Date.now().toString(36) + '-' + (++nextSessionCounter).toString(36);
  const session = {
    cwd: params && params.cwd ? params.cwd : process.cwd(),
    threadId: null,
    model: 'smart',
    effort: 'high',
    permission: 'default',
    child: null,
    cancelled: false,
  };
  sessions.set(sessionId, session);
  setImmediate(() => {
    notifySessionUpdate(sessionId, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'init', description: 'Generate an AGENTS.md file for the project' }],
    });
  });
  return { sessionId, configOptions: buildConfigOptions(session) };
}

function textFromPrompt(prompt) {
  let text = '';
  for (const chunk of prompt || []) {
    if (chunk.type === 'text') {
      text += chunk.text;
    } else if (chunk.type === 'resource_link') {
      text += '\n' + chunk.uri + '\n';
    } else if (chunk.type === 'resource' && chunk.resource && typeof chunk.resource.text === 'string') {
      text += '\n<context ref="' + chunk.resource.uri + '">\n' + chunk.resource.text + '\n</context>\n';
    }
  }
  return text;
}

function toolMetadata(name, input) {
  const title = typeof name === 'string' && name.length > 0 ? name : 'Tool';
  let kind = 'other';
  if (/read|view|cat/i.test(title)) kind = 'read';
  else if (/edit|write|patch/i.test(title)) kind = 'edit';
  else if (/delete|remove/i.test(title)) kind = 'delete';
  else if (/move|rename/i.test(title)) kind = 'move';
  else if (/search|grep|find/i.test(title)) kind = 'search';
  else if (/bash|shell|exec|command|terminal/i.test(title)) kind = 'execute';
  return { title, kind, rawInput: input === undefined ? undefined : input };
}

function acpContentArray(content, isError) {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && item.type === 'text') return item.text;
        return '';
      })
      .filter(Boolean)
      .map((text) => ({ type: 'content', content: { type: 'text', text } }));
  }
  if (typeof content === 'string' && content.length > 0) {
    return [{ type: 'content', content: { type: 'text', text: content } }];
  }
  return [];
}

function emitAmpMessage(sessionId, message) {
  const content = message && message.message ? message.message.content : undefined;
  const role = message.type === 'assistant' ? 'agent_message_chunk' : 'user_message_chunk';
  if (typeof content === 'string') {
    notifySessionUpdate(sessionId, { sessionUpdate: role, content: { type: 'text', text: content } });
    return true;
  }
  if (!Array.isArray(content)) return false;
  let emitted = false;
  for (const chunk of content) {
    if (!chunk) continue;
    if (chunk.type === 'text' && chunk.text) {
      notifySessionUpdate(sessionId, { sessionUpdate: role, content: { type: 'text', text: chunk.text } });
      emitted = true;
    } else if (chunk.type === 'thinking' && chunk.thinking) {
      notifySessionUpdate(sessionId, {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: chunk.thinking },
      });
      emitted = true;
    } else if (chunk.type === 'tool_use') {
      const meta = toolMetadata(chunk.name, chunk.input);
      notifySessionUpdate(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: chunk.id,
        title: meta.title,
        kind: meta.kind,
        rawInput: meta.rawInput,
        status: 'pending',
        content: [],
      });
      emitted = true;
    } else if (chunk.type === 'tool_result') {
      notifySessionUpdate(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: chunk.tool_use_id,
        status: chunk.is_error ? 'failed' : 'completed',
        content: acpContentArray(chunk.content, chunk.is_error),
      });
      emitted = true;
    }
  }
  return emitted;
}

function buildAmpArgs(session) {
  const args = [];
  if (session.threadId) args.push('threads', 'continue', session.threadId);
  args.push('--execute', '--stream-json', '--mode', session.model);
  if (effortLevelsForModel(session.model).includes(session.effort)) {
    args.push('--effort', session.effort);
  }
  if (session.permission === 'bypass') args.push('--dangerously-allow-all');
  return args;
}

function runPrompt(sessionId, params) {
  return new Promise((resolve, reject) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const command = process.env.AMP_CLI_PATH || 'amp';
    const child = spawn(command, buildAmpArgs(session), {
      cwd: session.cwd,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    session.child = child;
    session.cancelled = false;

    let stderr = '';
    let stdoutBuffer = '';
    let emittedAssistant = false;
    let resultText = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (process.env.AMP_DEBUG) process.stderr.write(chunk);
    });
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      for (;;) {
        const newline = stdoutBuffer.indexOf('\n');
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (!session.threadId && typeof message.session_id === 'string') session.threadId = message.session_id;
        if (message.type === 'assistant') {
          emittedAssistant = emitAmpMessage(sessionId, message) || emittedAssistant;
        } else if (message.type === 'result') {
          if (typeof message.result === 'string') resultText = message.result;
          if (message.is_error) {
            const text = typeof message.error === 'string' ? message.error : 'Amp returned an error.';
            notifySessionUpdate(sessionId, {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Error: ' + text },
            });
            emittedAssistant = true;
          }
        }
      }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      session.child = null;
      if (session.cancelled) return resolve({ stopReason: 'cancelled' });
      if (code !== 0) {
        return reject(new Error('Amp CLI exited with code ' + code + (stderr.trim() ? ': ' + stderr.trim() : '')));
      }
      if (!emittedAssistant && resultText) {
        notifySessionUpdate(sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: resultText },
        });
      }
      resolve({ stopReason: signal ? 'cancelled' : 'end_turn' });
    });
    child.stdin.end(textFromPrompt(params.prompt));
  });
}

async function handleRequest(message) {
  const id = message.id;
  try {
    switch (message.method) {
      case 'initialize':
        respond(id, {
          protocolVersion: 1,
          agentInfo: { name: 'amp', title: 'Amp', version: '1' },
          agentCapabilities: { promptCapabilities: { image: false, embeddedContext: true } },
        });
        return;
      case 'session/new':
        respond(id, newSession(message.params || {}));
        return;
      case 'session/prompt':
        respond(id, await runPrompt(message.params.sessionId, message.params));
        return;
      case 'session/cancel': {
        const session = sessions.get(message.params && message.params.sessionId);
        if (session && session.child) {
          session.cancelled = true;
          session.child.kill('SIGTERM');
        }
        respond(id, {});
        return;
      }
      case 'session/set_config_option': {
        const session = sessions.get(message.params && message.params.sessionId);
        if (!session) throw new Error('Session not found');
        const value = message.params.value;
        if (message.params.configId === 'amp-mode') {
          if (!['smart', 'deep', 'rush'].includes(value)) throw new Error('Unsupported Amp mode: ' + value);
          session.model = value;
          session.effort = defaultEffortForModel(value);
        } else if (message.params.configId === 'effort') {
          if (!effortLevelsForModel(session.model).includes(value)) throw new Error('Unsupported effort: ' + value);
          session.effort = value;
        } else if (message.params.configId === 'permission') {
          if (!['default', 'bypass'].includes(value)) throw new Error('Unsupported permission mode: ' + value);
          session.permission = value;
        }
        const configOptions = buildConfigOptions(session);
        notifySessionUpdate(message.params.sessionId, {
          sessionUpdate: 'config_option_update',
          configOptions,
        });
        respond(id, { configOptions });
        return;
      }
      default:
        respond(id, {});
    }
  } catch (error) {
    fail(id, error);
  }
}

readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message && message.method && message.id !== undefined) void handleRequest(message);
  });
`;
