import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { AgentTerminalManager } from './agent-terminal-manager';
import type { AcpProcessHost } from './transport';
import { readTextFile, writeTextFile } from './transport';

export class FsPort {
  constructor(private readonly host: AcpProcessHost) {}

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const content = await readTextFile(this.host.fs, params.path);
    return { content };
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    await writeTextFile(this.host.fs, params.path, params.content);
    return {};
  }
}

export class TerminalPort {
  constructor(private readonly terminals: AgentTerminalManager) {}

  async createTerminal(
    conversationId: string,
    defaultCwd: string,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const envRecord = params.env
      ? Object.fromEntries(params.env.map((e) => [e.name, e.value]))
      : {};
    const terminalId = await this.terminals.create(conversationId, {
      command: params.command,
      args: params.args ?? [],
      env: envRecord,
      cwd: params.cwd ?? defaultCwd,
      outputByteLimit: params.outputByteLimit,
    });
    return { terminalId };
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
    const snap = terminal.snapshot();
    return {
      output: snap.output,
      truncated: snap.truncated,
      exitStatus: snap.exitStatus ?? undefined,
    };
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
    const status = await terminal.waitForExit();
    return { exitCode: status.exitCode, signal: status.signal ?? undefined };
  }

  async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
    terminal.kill();
    return {};
  }

  releaseTerminal(params: ReleaseTerminalRequest): ReleaseTerminalResponse {
    this.terminals.release(params.terminalId);
    return {};
  }
}
