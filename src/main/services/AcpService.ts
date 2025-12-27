import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { extractCurrentModelId, extractModelsFromPayload } from '../../shared/acpUtils';
import type { AcpConfigOption, AcpModel } from '../../shared/types/acp';
import { log } from '../lib/logger';

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

type PermissionOutcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

type TerminalExitStatus = {
  exitCode: number | null;
  signal: string | null;
};

type TerminalRecord = {
  id: string;
  proc: any;
  output: string;
  truncated: boolean;
  outputByteLimit?: number;
  exitStatus?: TerminalExitStatus;
  waiters: Array<(status: TerminalExitStatus) => void>;
};

type AcpSessionState = {
  taskId: string;
  providerId: string;
  cwd: string;
  proc: ChildProcessWithoutNullStreams;
  sessionId: string;
  configOptions?: AcpConfigOption[];
  models?: AcpModel[];
  currentModelId?: string | null;
  pending: Map<number, PendingRequest>;
  pendingMeta: Map<number, { method: string; createdAt: number }>;
  pendingPermissions: Set<number>;
  terminals: Map<string, TerminalRecord>;
  agentInfo?: any;
  agentCapabilities?: any;
  protocolVersion?: number;
  buffer: string;
  lastStderr: string;
  exitInfo?: { code: number | null; signal: string | null };
  exitError?: string;
  closed: boolean;
};

type StartSessionArgs = {
  taskId: string;
  providerId: string;
  cwd: string;
};

type PromptArgs = {
  sessionId: string;
  prompt: Array<{ type: string; [key: string]: any }>;
};

type PermissionResponseArgs = {
  sessionId: string;
  requestId: number;
  outcome: PermissionOutcome;
};

type SessionKey = string;

const PROTOCOL_VERSION = 1;
const CODEX_ALLOWED_REASONING = new Set(['minimal', 'low', 'medium', 'high']);
const ACP_LOG_RAW = process.env.EMDASH_ACP_LOG_RAW === '1';

type CodexConfigSummary = {
  path: string;
  model?: string | null;
  reasoningEffort?: string | null;
  error?: string | null;
};

function logEnvSummary() {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean).length;
  log.debug('acp:env:summary', {
    execPath: process.execPath,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    home: os.homedir(),
    pathEntries,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    hasCodexKey: Boolean(process.env.CODEX_API_KEY),
  });
}

async function readCodexConfigSummary(): Promise<CodexConfigSummary | null> {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  try {
    const raw = await fsPromises.readFile(configPath, 'utf8').catch(() => null);
    if (!raw) return null;
    const reasoningMatch = raw.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m);
    const modelMatch = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    const reasoning = reasoningMatch?.[1]?.trim() || null;
    const model = modelMatch?.[1]?.trim() || null;
    let error: string | null = null;
    if (reasoning && !CODEX_ALLOWED_REASONING.has(reasoning)) {
      error = `Invalid Codex config: model_reasoning_effort="${reasoning}". Use one of: minimal, low, medium, high in ~/.codex/config.toml.`;
    }
    return { path: configPath, model, reasoningEffort: reasoning, error };
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    log.warn('acp:codexConfig:readFailed', { error: errorMessage });
  }
  return null;
}

function maybeLogRaw(label: string, payload: any) {
  if (!ACP_LOG_RAW) return;
  try {
    log.debug('acp:' + label, payload);
  } catch {
    log.debug('acp:' + label, '[unserializable]');
  }
}

function extractConfigOptions(payload: any): AcpConfigOption[] {
  if (!payload) return [];
  const direct =
    payload.configOptions ??
    payload.config_options ??
    payload.configs ??
    payload.options ??
    payload.config?.options;
  if (Array.isArray(direct)) return direct as AcpConfigOption[];
  const nested =
    payload.configOptions?.options ??
    payload.config_options?.options ??
    payload.config?.configOptions ??
    payload.config?.config_options;
  if (Array.isArray(nested)) return nested as AcpConfigOption[];
  return [];
}

function sessionKey(taskId: string, providerId: string): SessionKey {
  return `${taskId}:${providerId}`;
}

function emitEvent(payload: any) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('acp:event', payload);
      } catch {}
    }
  } catch {}
}

function isAbsolutePath(p: string): boolean {
  return typeof p === 'string' && path.isAbsolute(p);
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root);
  return resolved.endsWith(path.sep) ? resolved : resolved + path.sep;
}

function ensureWithinRoot(root: string, targetPath: string): string {
  const resolvedRoot = normalizeRoot(root);
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error('Path escapes session root');
  }
  return resolvedTarget;
}

function sliceUtf8FromEnd(input: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(input, 'utf8');
  if (buf.length <= maxBytes) return { text: input, truncated: false };
  let start = Math.max(0, buf.length - maxBytes);
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return { text: buf.slice(start).toString('utf8'), truncated: true };
}

function buildCleanEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const defaultShell = process.env.SHELL || '/bin/bash';
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    SHELL: defaultShell,
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...(process.env.DISPLAY && { DISPLAY: process.env.DISPLAY }),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(extraEnv || {}),
  };
}

function resolveAdapterCommand(providerId: string): { command: string; args: string[] }[] {
  if (providerId === 'codex') {
    const preferSystem = process.env.EMDASH_ACP_PREFER_SYSTEM === '1';
    const npxCmd = { command: 'npx', args: ['-y', '@zed-industries/codex-acp@latest'] };
    const systemCmd = { command: 'codex-acp', args: [] };
    return preferSystem ? [systemCmd, npxCmd] : [npxCmd, systemCmd];
  }
  return [];
}

class AcpService {
  private sessions = new Map<SessionKey, AcpSessionState>();
  private sessionById = new Map<string, AcpSessionState>();
  private nextId = 1;

  async startSession(
    args: StartSessionArgs
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    const { taskId, providerId, cwd } = args;
    log.debug('acp:startSession', { taskId, providerId, cwd });
    logEnvSummary();
    if (providerId === 'codex') {
      const configSummary = await readCodexConfigSummary();
      if (configSummary) {
        log.debug('acp:codexConfig:summary', configSummary);
        if (configSummary.error) {
          log.warn('acp:startSession:codexConfigInvalid', {
            taskId,
            providerId,
            error: configSummary.error,
          });
          emitEvent({ type: 'session_error', taskId, providerId, error: configSummary.error });
          return { success: false, error: configSummary.error };
        }
      } else {
        log.debug('acp:codexConfig:missing', { taskId, providerId });
      }
      if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) {
        log.warn('acp:startSession:missingApiKey', {
          taskId,
          providerId,
          note: 'OPENAI_API_KEY or CODEX_API_KEY not set; adapter may rely on ChatGPT auth.',
        });
      }
    }
    const key = sessionKey(taskId, providerId);
    const existing = this.sessions.get(key);
    if (existing && !existing.closed) {
      log.debug('acp:startSession:existing', { taskId, providerId, sessionId: existing.sessionId });
      return { success: true, sessionId: existing.sessionId };
    }

    const adapters = resolveAdapterCommand(providerId);
    log.debug('acp:adapter:candidates', { taskId, providerId, adapters });
    if (adapters.length === 0) {
      return { success: false, error: `No ACP adapter configured for ${providerId}` };
    }

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = await this.spawnAdapter(adapters, cwd);
    } catch (error: any) {
      log.warn('acp:startSession:spawnFailed', {
        taskId,
        providerId,
        error: error?.message || String(error),
      });
      return { success: false, error: error?.message || String(error) };
    }

    const state: AcpSessionState = {
      taskId,
      providerId,
      cwd,
      proc,
      sessionId: '',
      configOptions: [],
      models: [],
      currentModelId: null,
      pending: new Map(),
      pendingMeta: new Map(),
      pendingPermissions: new Set(),
      terminals: new Map(),
      buffer: '',
      lastStderr: '',
      closed: false,
    };

    this.sessions.set(key, state);

    proc.stdout.on('data', (chunk) => this.handleStdout(state, chunk.toString('utf8')));
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.trim()) {
        state.lastStderr = `${state.lastStderr}${text}`.slice(-8000);
        log.warn('acp:stderr', { taskId, providerId, text: text.trim().slice(0, 2000) });
      }
    });
    proc.on('error', (error) => {
      log.warn('acp:proc:error', {
        taskId,
        providerId,
        error: (error as Error)?.message || String(error),
      });
    });
    proc.on('exit', (code, signal) => {
      state.closed = true;
      state.exitInfo = {
        code: typeof code === 'number' ? code : null,
        signal: signal ? String(signal) : null,
      };
      const stderrHint = state.lastStderr.trim();
      state.exitError = stderrHint
        ? `ACP adapter exited. stderr: ${stderrHint.slice(0, 2000)}`
        : `ACP adapter exited (code ${state.exitInfo.code ?? 'unknown'})`;
      log.warn('acp:proc:exit', { taskId, providerId, sessionId: state.sessionId, code, signal });
      emitEvent({
        type: 'session_exit',
        taskId,
        providerId,
        sessionId: state.sessionId,
        code,
        signal: signal ? String(signal) : null,
      });
      this.cleanupSession(state);
    });

    try {
      const initRes = await this.sendRequest(state, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: {
          name: 'emdash',
          title: 'Emdash',
          version: app.getVersion(),
        },
      });
      log.debug('acp:initialize:response', {
        taskId,
        providerId,
        protocolVersion: initRes?.protocolVersion,
        agentInfo: initRes?.agentInfo,
        agentCapabilities: initRes?.agentCapabilities,
        authMethods: initRes?.authMethods,
      });
      state.protocolVersion = initRes?.protocolVersion ?? PROTOCOL_VERSION;
      state.agentInfo = initRes?.agentInfo;
      state.agentCapabilities = initRes?.agentCapabilities;

      if (state.protocolVersion !== PROTOCOL_VERSION) {
        emitEvent({
          type: 'session_error',
          taskId,
          providerId,
          error: `Unsupported ACP version ${state.protocolVersion}`,
        });
      }

      const sessionRes = await this.sendRequest(state, 'session/new', {
        cwd,
        mcpServers: [],
      });
      log.debug('acp:session/new:response', { taskId, providerId, sessionRes });
      const sessionId = sessionRes?.sessionId as string | undefined;
      const configOptions = extractConfigOptions(sessionRes);
      const models = extractModelsFromPayload(sessionRes);
      const currentModelId = extractCurrentModelId(sessionRes);
      log.debug('acp:session/new:config', {
        taskId,
        providerId,
        configOptionsCount: configOptions.length,
        modelsCount: models.length,
        currentModelId,
      });
      let modes: any[] = [];
      let currentModeId: string | null =
        sessionRes?.currentModeId ?? sessionRes?.modeId ?? sessionRes?.current_mode_id ?? null;
      const modesPayload = sessionRes?.modes;
      if (Array.isArray(modesPayload)) {
        modes = modesPayload;
      } else if (modesPayload && typeof modesPayload === 'object') {
        modes = Array.isArray(modesPayload.availableModes) ? modesPayload.availableModes : [];
        currentModeId = modesPayload.currentModeId ?? modesPayload.modeId ?? currentModeId ?? null;
      }
      if (!sessionId) {
        log.warn('acp:session/new:missingSessionId', { taskId, providerId, sessionRes });
        throw new Error('Missing sessionId from ACP agent');
      }
      state.sessionId = sessionId;
      state.configOptions = configOptions;
      state.models = models;
      state.currentModelId = currentModelId ?? null;
      this.sessionById.set(sessionId, state);

      emitEvent({
        type: 'session_started',
        taskId,
        providerId,
        sessionId,
        agentInfo: state.agentInfo,
        agentCapabilities: state.agentCapabilities,
        modes,
        currentModeId,
        configOptions,
        models,
        currentModelId,
      });
      log.debug('acp:session_started', { taskId, providerId, sessionId });
      return { success: true, sessionId };
    } catch (error: any) {
      const message = error?.message || String(error);
      log.warn('acp:startSession:error', { taskId, providerId, error: message });
      emitEvent({ type: 'session_error', taskId, providerId, error: message });
      this.closeSession(state);
      return { success: false, error: message };
    }
  }

  async sendPrompt(
    args: PromptArgs
  ): Promise<{ success: boolean; stopReason?: string; error?: string }> {
    const state = this.sessionById.get(args.sessionId);
    log.debug('acp:sendPrompt', {
      sessionId: args.sessionId,
      taskId: state?.taskId,
      providerId: state?.providerId,
      blockCount: Array.isArray(args.prompt) ? args.prompt.length : 0,
      blockTypes: Array.isArray(args.prompt) ? args.prompt.map((b) => b.type) : [],
    });
    if (!state) return { success: false, error: 'Session not found' };
    try {
      const res = await this.sendRequest(state, 'session/prompt', {
        sessionId: args.sessionId,
        prompt: args.prompt,
      });
      log.debug('acp:session/prompt:response', {
        sessionId: args.sessionId,
        taskId: state.taskId,
        providerId: state.providerId,
        stopReason: res?.stopReason,
      });
      const stopReason = res?.stopReason as string | undefined;
      emitEvent({
        type: 'prompt_end',
        taskId: state.taskId,
        providerId: state.providerId,
        sessionId: args.sessionId,
        stopReason,
      });
      return { success: true, stopReason };
    } catch (error: any) {
      log.warn('acp:sendPrompt:error', {
        sessionId: args.sessionId,
        error: error?.message || String(error),
      });
      return { success: false, error: error?.message || String(error) };
    }
  }

  cancelSession(sessionId: string) {
    const state = this.sessionById.get(sessionId);
    if (!state || state.closed) return;
    log.debug('acp:cancelSession', {
      sessionId,
      taskId: state.taskId,
      providerId: state.providerId,
    });
    this.sendNotification(state, 'session/cancel', { sessionId });
  }

  disposeSession(sessionId: string) {
    const state = this.sessionById.get(sessionId);
    if (!state) return;
    log.debug('acp:disposeSession', {
      sessionId,
      taskId: state.taskId,
      providerId: state.providerId,
    });
    this.closeSession(state);
  }

  respondPermission(args: PermissionResponseArgs): { success: boolean; error?: string } {
    const state = this.sessionById.get(args.sessionId);
    log.debug('acp:respondPermission', {
      sessionId: args.sessionId,
      requestId: args.requestId,
      outcome: args.outcome,
    });
    if (!state) return { success: false, error: 'Session not found' };
    if (!state.pendingPermissions.has(args.requestId)) {
      log.warn('acp:respondPermission:missingRequest', {
        sessionId: args.sessionId,
        requestId: args.requestId,
      });
      return { success: false, error: 'Permission request not found' };
    }
    state.pendingPermissions.delete(args.requestId);
    this.sendResponse(state, args.requestId, { outcome: args.outcome });
    return { success: true };
  }

  async setMode(sessionId: string, modeId: string): Promise<{ success: boolean; error?: string }> {
    const state = this.sessionById.get(sessionId);
    log.debug('acp:setMode', {
      sessionId,
      modeId,
      taskId: state?.taskId,
      providerId: state?.providerId,
    });
    if (!state) return { success: false, error: 'Session not found' };
    try {
      await this.sendRequest(state, 'session/set_mode', {
        sessionId,
        modeId,
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  async setModel(
    sessionId: string,
    modelId: string
  ): Promise<{ success: boolean; error?: string }> {
    const state = this.sessionById.get(sessionId);
    log.debug('acp:setModel', {
      sessionId,
      modelId,
      taskId: state?.taskId,
      providerId: state?.providerId,
    });
    if (!state) return { success: false, error: 'Session not found' };
    if (!modelId) return { success: false, error: 'Missing modelId' };
    try {
      const res = await this.sendRequest(state, 'session/set_model', {
        sessionId,
        modelId,
      });
      const models = extractModelsFromPayload(res);
      const currentModelId = extractCurrentModelId(res) ?? modelId;
      if (models.length) state.models = models;
      state.currentModelId = currentModelId;
      const configOptions = extractConfigOptions(res);
      if (configOptions.length) {
        state.configOptions = configOptions;
      }
      emitEvent({
        type: 'session_update',
        taskId: state.taskId,
        providerId: state.providerId,
        sessionId: state.sessionId,
        update: {
          sessionUpdate: 'model_update',
          models: state.models,
          currentModelId: state.currentModelId,
          configOptions: configOptions.length ? configOptions : undefined,
        },
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: unknown
  ): Promise<{ success: boolean; error?: string }> {
    const state = this.sessionById.get(sessionId);
    log.debug('acp:setConfigOption', {
      sessionId,
      configId,
      taskId: state?.taskId,
      providerId: state?.providerId,
    });
    if (!state) return { success: false, error: 'Session not found' };
    if (!configId) return { success: false, error: 'Missing configId' };
    try {
      const res = await this.sendRequest(state, 'session/set_config_option', {
        sessionId,
        configId,
        value,
      });
      const configOptions = extractConfigOptions(res);
      const models = extractModelsFromPayload(res);
      const currentModelId = extractCurrentModelId(res);
      if (configOptions.length) {
        state.configOptions = configOptions;
      }
      if (models.length) {
        state.models = models;
      }
      if (currentModelId) {
        state.currentModelId = currentModelId;
      }
      if (configOptions.length || models.length || currentModelId != null) {
        emitEvent({
          type: 'session_update',
          taskId: state.taskId,
          providerId: state.providerId,
          sessionId: state.sessionId,
          update: {
            sessionUpdate: 'config_option_update',
            configOptions: configOptions.length ? configOptions : undefined,
            models: models.length ? models : undefined,
            currentModelId: currentModelId ?? undefined,
          },
        });
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  private sendRequest(state: AcpSessionState, method: string, params?: any): Promise<any> {
    const id = this.nextId++;
    const payload: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    const body = JSON.stringify(payload);
    const paramSummary =
      method === 'session/prompt' && params?.prompt
        ? {
            promptCount: Array.isArray(params.prompt) ? params.prompt.length : 0,
            promptTypes: Array.isArray(params.prompt) ? params.prompt.map((b: any) => b?.type) : [],
          }
        : method === 'session/new'
          ? { cwd: params?.cwd }
          : undefined;
    log.debug('acp:sendRequest', { id, method, sessionId: state.sessionId, paramSummary });
    maybeLogRaw('sendRequest:payload', payload);
    state.proc.stdin.write(body + '\n');
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      state.pendingMeta.set(id, { method, createdAt: Date.now() });
    });
  }

  private sendNotification(state: AcpSessionState, method: string, params?: any) {
    const payload: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    log.debug('acp:sendNotification', { method, sessionId: state.sessionId });
    maybeLogRaw('sendNotification:payload', payload);
    state.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  private sendResponse(state: AcpSessionState, id: number, result: any) {
    const payload: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      result,
    };
    log.debug('acp:sendResponse', { id, sessionId: state.sessionId });
    maybeLogRaw('sendResponse:payload', payload);
    state.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  private sendError(state: AcpSessionState, id: number, code: number, message: string) {
    const payload: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    log.warn('acp:sendError', { id, code, message, sessionId: state.sessionId });
    maybeLogRaw('sendError:payload', payload);
    state.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  private handleStdout(state: AcpSessionState, chunk: string) {
    state.buffer += chunk;
    let idx = state.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (line.length > 0) {
        log.debug('acp:recv', {
          sessionId: state.sessionId,
          length: line.length,
          line: line.slice(0, 2000),
        });
        if (ACP_LOG_RAW) {
          log.debug('acp:recv:raw', line);
        }
        this.handleMessage(state, line);
      }
      idx = state.buffer.indexOf('\n');
    }
  }

  private handleMessage(state: AcpSessionState, line: string) {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch (error) {
      log.warn('acp:parseFailed', { line: line.slice(0, 200), error });
      return;
    }

    if (msg.id !== undefined && msg.method) {
      log.debug('acp:recv:request', { id: msg.id, method: msg.method, sessionId: state.sessionId });
      this.handleRequest(state, msg as JsonRpcMessage & { id: number; method: string });
      return;
    }

    if (msg.id !== undefined) {
      log.debug('acp:recv:response', {
        id: msg.id,
        sessionId: state.sessionId,
        hasError: Boolean(msg.error),
      });
      const pending = state.pending.get(msg.id);
      if (!pending) return;
      const meta = state.pendingMeta.get(msg.id);
      state.pending.delete(msg.id);
      state.pendingMeta.delete(msg.id);
      if (msg.error) {
        const dataText =
          msg.error.data !== undefined && msg.error.data !== null
            ? typeof msg.error.data === 'string'
              ? msg.error.data
              : JSON.stringify(msg.error.data)
            : '';
        const detail = dataText ? `: ${dataText}` : '';
        if (meta) {
          log.warn('acp:recv:response:error', {
            id: msg.id,
            method: meta.method,
            error: msg.error,
          });
        }
        pending.reject(new Error(`${msg.error.message || 'ACP error'}${detail}`));
      } else {
        if (meta) {
          log.debug('acp:recv:response:ok', {
            id: msg.id,
            method: meta.method,
            elapsedMs: Date.now() - meta.createdAt,
          });
        }
        pending.resolve(msg.result);
      }
      return;
    }

    if (msg.method) {
      log.debug('acp:recv:notification', { method: msg.method, sessionId: state.sessionId });
      this.handleNotification(state, msg.method, msg.params);
    }
  }

  private async handleRequest(
    state: AcpSessionState,
    msg: JsonRpcMessage & { id: number; method: string }
  ) {
    const { id, method, params } = msg;
    try {
      switch (method) {
        case 'session/request_permission': {
          state.pendingPermissions.add(id);
          log.debug('acp:request_permission', { id, sessionId: state.sessionId, params });
          emitEvent({
            type: 'permission_request',
            taskId: state.taskId,
            providerId: state.providerId,
            sessionId: state.sessionId,
            requestId: id,
            params,
          });
          return;
        }
        case 'fs/read_text_file': {
          log.debug('acp:fs/read_text_file', {
            id,
            sessionId: state.sessionId,
            path: params?.path,
            line: params?.line,
            limit: params?.limit,
          });
          const result = await this.readTextFile(state, params);
          this.sendResponse(state, id, result);
          return;
        }
        case 'fs/write_text_file': {
          log.debug('acp:fs/write_text_file', {
            id,
            sessionId: state.sessionId,
            path: params?.path,
            length: typeof params?.content === 'string' ? params.content.length : undefined,
          });
          await this.writeTextFile(state, params);
          this.sendResponse(state, id, null);
          return;
        }
        case 'terminal/create': {
          log.debug('acp:terminal/create', {
            id,
            sessionId: state.sessionId,
            command: params?.command,
            args: params?.args,
            cwd: params?.cwd,
          });
          const result = this.createTerminal(state, params);
          this.sendResponse(state, id, result);
          return;
        }
        case 'terminal/output': {
          log.debug('acp:terminal/output', {
            id,
            sessionId: state.sessionId,
            terminalId: params?.terminalId,
          });
          const result = this.getTerminalOutput(state, params);
          this.sendResponse(state, id, result);
          return;
        }
        case 'terminal/write': {
          log.debug('acp:terminal/write', {
            id,
            sessionId: state.sessionId,
            terminalId: params?.terminalId,
            bytes: params?.data?.length,
          });
          this.writeTerminal(state, params);
          this.sendResponse(state, id, null);
          return;
        }
        case 'terminal/resize': {
          log.debug('acp:terminal/resize', {
            id,
            sessionId: state.sessionId,
            terminalId: params?.terminalId,
            cols: params?.cols,
            rows: params?.rows,
          });
          this.resizeTerminal(state, params);
          this.sendResponse(state, id, null);
          return;
        }
        case 'terminal/wait_for_exit': {
          log.debug('acp:terminal/wait_for_exit', {
            id,
            sessionId: state.sessionId,
            terminalId: params?.terminalId,
          });
          const result = await this.waitForTerminalExit(state, params);
          this.sendResponse(state, id, result);
          return;
        }
        case 'terminal/kill': {
          log.debug('acp:terminal/kill', {
            id,
            sessionId: state.sessionId,
            terminalId: params?.terminalId,
          });
          this.killTerminal(state, params);
          this.sendResponse(state, id, null);
          return;
        }
        case 'terminal/release': {
          log.debug('acp:terminal/release', {
            id,
            sessionId: state.sessionId,
            terminalId: params?.terminalId,
          });
          this.releaseTerminal(state, params);
          this.sendResponse(state, id, null);
          return;
        }
        default:
          this.sendError(state, id, -32601, `Method not found: ${method}`);
      }
    } catch (error: any) {
      log.warn('acp:handleRequest:error', { id, method, error: error?.message || String(error) });
      this.sendError(state, id, -32000, error?.message || String(error));
    }
  }

  private handleNotification(state: AcpSessionState, method: string, params: any) {
    if (method === 'session/update') {
      log.debug('acp:session/update', {
        sessionId: params?.sessionId,
        updateType: params?.update?.sessionUpdate || params?.update?.type || params?.update?.kind,
      });
      const updateType =
        params?.update?.sessionUpdate || params?.update?.type || params?.update?.kind;
      if (updateType === 'config_option_update' || updateType === 'config_options_update') {
        const nextOptions = extractConfigOptions(params?.update);
        if (nextOptions.length) {
          state.configOptions = nextOptions;
        }
      }
      const nextModels = extractModelsFromPayload(params?.update);
      if (nextModels.length) {
        state.models = nextModels;
      }
      const nextCurrentModelId = extractCurrentModelId(params?.update);
      if (nextCurrentModelId != null) {
        state.currentModelId = nextCurrentModelId;
      }
      emitEvent({
        type: 'session_update',
        taskId: state.taskId,
        providerId: state.providerId,
        sessionId: params?.sessionId,
        update: params?.update,
      });
      return;
    }
  }

  private async readTextFile(state: AcpSessionState, params: any): Promise<{ content: string }> {
    const sessionId = params?.sessionId;
    if (!sessionId || sessionId !== state.sessionId) throw new Error('Invalid session');
    const filePath = params?.path;
    if (!filePath || !isAbsolutePath(filePath)) throw new Error('Invalid path');
    const abs = ensureWithinRoot(state.cwd, filePath);
    const raw = await fsPromises.readFile(abs, 'utf8');
    const line = typeof params?.line === 'number' ? params.line : undefined;
    const limit = typeof params?.limit === 'number' ? params.limit : undefined;
    if (!line && !limit) return { content: raw };
    const lines = raw.split('\n');
    const startIdx = Math.max(0, (line ?? 1) - 1);
    const endIdx = limit ? Math.min(lines.length, startIdx + limit) : lines.length;
    const sliced = lines.slice(startIdx, endIdx).join('\n');
    return { content: sliced };
  }

  private async writeTextFile(state: AcpSessionState, params: any): Promise<void> {
    const sessionId = params?.sessionId;
    if (!sessionId || sessionId !== state.sessionId) throw new Error('Invalid session');
    const filePath = params?.path;
    if (!filePath || !isAbsolutePath(filePath)) throw new Error('Invalid path');
    const abs = ensureWithinRoot(state.cwd, filePath);
    const dir = path.dirname(abs);
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(abs, String(params?.content ?? ''), 'utf8');
  }

  private createTerminal(state: AcpSessionState, params: any): { terminalId: string } {
    const sessionId = params?.sessionId;
    if (!sessionId || sessionId !== state.sessionId) throw new Error('Invalid session');
    const command = params?.command;
    if (!command || typeof command !== 'string') throw new Error('Invalid command');
    const args = Array.isArray(params?.args) ? params.args.map(String) : [];
    const cwd = typeof params?.cwd === 'string' ? params.cwd : state.cwd;
    const resolvedCwd = isAbsolutePath(cwd) ? ensureWithinRoot(state.cwd, cwd) : state.cwd;
    const outputByteLimit =
      typeof params?.outputByteLimit === 'number' ? params.outputByteLimit : undefined;
    const cols = typeof params?.cols === 'number' ? params.cols : 120;
    const rows = typeof params?.rows === 'number' ? params.rows : 32;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let pty: typeof import('node-pty');
    try {
      pty = require('node-pty');
    } catch (e: any) {
      throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
    }

    const envVars: Record<string, string> = {};
    if (Array.isArray(params?.env)) {
      for (const pair of params.env) {
        if (!pair?.name) continue;
        envVars[String(pair.name)] = String(pair.value ?? '');
      }
    }

    const terminalId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: resolvedCwd,
      env: buildCleanEnv(envVars),
    });

    const record: TerminalRecord = {
      id: terminalId,
      proc,
      output: '',
      truncated: false,
      outputByteLimit,
      waiters: [],
    };

    proc.onData((data: string) => {
      record.output += data;
      if (record.outputByteLimit && record.outputByteLimit > 0) {
        const sliced = sliceUtf8FromEnd(record.output, record.outputByteLimit);
        record.output = sliced.text;
        record.truncated = sliced.truncated;
      }
      emitEvent({
        type: 'terminal_output',
        taskId: state.taskId,
        providerId: state.providerId,
        sessionId: state.sessionId,
        terminalId,
        chunk: data,
        truncated: record.truncated,
      });
    });

    proc.onExit(({ exitCode, signal }) => {
      record.exitStatus = {
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        signal: signal ? String(signal) : null,
      };
      const waiters = [...record.waiters];
      record.waiters = [];
      waiters.forEach((w) => w(record.exitStatus!));
      emitEvent({
        type: 'terminal_exit',
        taskId: state.taskId,
        providerId: state.providerId,
        sessionId: state.sessionId,
        terminalId,
        exitStatus: record.exitStatus,
      });
    });

    state.terminals.set(terminalId, record);
    return { terminalId };
  }

  private getTerminalOutput(state: AcpSessionState, params: any) {
    const terminalId = params?.terminalId;
    if (!terminalId || typeof terminalId !== 'string') throw new Error('Invalid terminalId');
    const record = state.terminals.get(terminalId);
    if (!record) throw new Error('Terminal not found');
    let output = record.output;
    let truncated = record.truncated;
    const outputByteLimit =
      typeof params?.outputByteLimit === 'number' ? params.outputByteLimit : undefined;
    if (outputByteLimit && outputByteLimit > 0) {
      const sliced = sliceUtf8FromEnd(output, outputByteLimit);
      output = sliced.text;
      truncated = sliced.truncated || record.truncated;
    }
    const result: any = {
      output,
      truncated,
    };
    if (record.exitStatus) {
      result.exitStatus = {
        exitCode: record.exitStatus.exitCode,
        signal: record.exitStatus.signal,
      };
    }
    return result;
  }

  private waitForTerminalExit(state: AcpSessionState, params: any) {
    const terminalId = params?.terminalId;
    if (!terminalId || typeof terminalId !== 'string') throw new Error('Invalid terminalId');
    const record = state.terminals.get(terminalId);
    if (!record) throw new Error('Terminal not found');
    if (record.exitStatus) {
      return record.exitStatus;
    }
    return new Promise<TerminalExitStatus>((resolve) => {
      record.waiters.push(resolve);
    });
  }

  private writeTerminal(state: AcpSessionState, params: any) {
    const terminalId = params?.terminalId;
    if (!terminalId || typeof terminalId !== 'string') throw new Error('Invalid terminalId');
    const record = state.terminals.get(terminalId);
    if (!record) throw new Error('Terminal not found');
    const data = typeof params?.data === 'string' ? params.data : '';
    if (data) {
      try {
        record.proc.write(data);
      } catch (err) {
        log.debug('terminal:write:failed', {
          terminalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private resizeTerminal(state: AcpSessionState, params: any) {
    const terminalId = params?.terminalId;
    if (!terminalId || typeof terminalId !== 'string') throw new Error('Invalid terminalId');
    const record = state.terminals.get(terminalId);
    if (!record) throw new Error('Terminal not found');
    const cols = typeof params?.cols === 'number' ? params.cols : undefined;
    const rows = typeof params?.rows === 'number' ? params.rows : undefined;
    if (cols && rows) {
      try {
        record.proc.resize(cols, rows);
      } catch {}
    }
  }

  private killTerminal(state: AcpSessionState, params: any) {
    const terminalId = params?.terminalId;
    if (!terminalId || typeof terminalId !== 'string') throw new Error('Invalid terminalId');
    const record = state.terminals.get(terminalId);
    if (!record) throw new Error('Terminal not found');
    try {
      record.proc.kill();
    } catch {}
  }

  private releaseTerminal(state: AcpSessionState, params: any) {
    const terminalId = params?.terminalId;
    if (!terminalId || typeof terminalId !== 'string') throw new Error('Invalid terminalId');
    const record = state.terminals.get(terminalId);
    if (!record) return;
    try {
      record.proc.kill();
    } catch {}
    state.terminals.delete(terminalId);
  }

  private closeSession(state: AcpSessionState) {
    if (state.closed) return;
    state.closed = true;
    log.warn('acp:closeSession', {
      taskId: state.taskId,
      providerId: state.providerId,
      sessionId: state.sessionId,
    });
    try {
      state.proc.kill();
    } catch {}
    this.cleanupSession(state);
  }

  private cleanupSession(state: AcpSessionState) {
    log.debug('acp:cleanupSession', {
      taskId: state.taskId,
      providerId: state.providerId,
      sessionId: state.sessionId,
    });
    for (const terminal of state.terminals.values()) {
      try {
        terminal.proc.kill();
      } catch {}
    }
    state.terminals.clear();
    for (const [id, pending] of state.pending.entries()) {
      const message = state.exitError || 'Session closed';
      const meta = state.pendingMeta.get(id);
      if (meta) {
        log.warn('acp:cleanupSession:pending', {
          id,
          method: meta.method,
          ageMs: Date.now() - meta.createdAt,
        });
      }
      pending.reject(new Error(message));
      state.pending.delete(id);
    }
    state.pendingMeta.clear();
    state.pendingPermissions.clear();
    const key = sessionKey(state.taskId, state.providerId);
    this.sessions.delete(key);
    if (state.sessionId) {
      this.sessionById.delete(state.sessionId);
    }
  }

  private spawnAdapter(
    candidates: { command: string; args: string[] }[],
    cwd: string
  ): Promise<ChildProcessWithoutNullStreams> {
    return new Promise((resolve, reject) => {
      const trySpawn = (index: number) => {
        if (index >= candidates.length) {
          log.warn('acp:spawnAdapter:exhausted', { cwd, candidates });
          reject(new Error('Failed to start ACP adapter'));
          return;
        }
        const candidate = candidates[index];
        log.debug('acp:spawnAdapter:try', {
          command: candidate.command,
          args: candidate.args,
          cwd,
        });
        const child = spawn(candidate.command, candidate.args, {
          cwd,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const handleError = (err: any) => {
          if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            log.warn('acp:spawnAdapter:missing', { command: candidate.command, cwd });
            trySpawn(index + 1);
          } else {
            log.warn('acp:spawnAdapter:error', {
              command: candidate.command,
              error: err?.message || String(err),
            });
            reject(err);
          }
        };
        child.once('error', handleError);
        child.once('spawn', () => {
          child.off('error', handleError);
          log.debug('acp:spawnAdapter:success', { command: candidate.command, pid: child.pid });
          resolve(child);
        });
      };
      trySpawn(0);
    });
  }
}

export const acpService = new AcpService();
