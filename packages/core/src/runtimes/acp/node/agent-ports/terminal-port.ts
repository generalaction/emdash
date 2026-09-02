import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk';
import { currentAgentEnvPlatform, mergeAgentEnvLayers } from '#primitives/agent-env/api';
import { buildTerminalEnv } from '#services/pty/api';
import type { AgentTerminalManager } from './terminal-manager';

export class TerminalPort {
  constructor(
    private readonly terminals: AgentTerminalManager,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async createTerminal(
    conversationId: string,
    defaultCwd: string,
    agentEnv: Readonly<Record<string, string>>,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const envRecord = mergeAgentEnvLayers(
      currentAgentEnvPlatform(this.platform),
      buildTerminalEnv({
        baseEnv: agentEnv,
        overrides: params.env
          ? Object.fromEntries(params.env.map((entry) => [entry.name, entry.value]))
          : {},
      })
    );
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
    if (!terminal) throw new Error(`AcpRuntime: terminal not found: ${params.terminalId}`);
    const snap = terminal.outputSnapshot();
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
    if (!terminal) throw new Error(`AcpRuntime: terminal not found: ${params.terminalId}`);
    const status = await terminal.waitForExit();
    return { exitCode: status.exitCode, signal: status.signal ?? undefined };
  }

  async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw new Error(`AcpRuntime: terminal not found: ${params.terminalId}`);
    await terminal.kill();
    return {};
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    await this.terminals.release(params.terminalId);
    return {};
  }
}
