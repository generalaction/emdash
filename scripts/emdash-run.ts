#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ContainerConfigError, resolveContainerConfig } from '../src/shared/container/config';
import { generateMockStartEvents } from '../src/shared/container/mockRunner';
import { PortManager } from '../src/shared/container/portManager';

interface StartCommandOptions {
  workspaceId: string;
  configPath: string;
  runId?: string;
  mode?: 'container' | 'host';
}

interface ParsedArgs {
  command: 'start' | 'help';
  options: StartCommandOptions;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  const command = (commandRaw ?? 'help') as ParsedArgs['command'];

  if (command !== 'start') {
    return { command: 'help', options: { workspaceId: '', configPath: '.emdash/config.json' } };
  }

  const options: StartCommandOptions = {
    workspaceId: '',
    configPath: '.emdash/config.json',
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg) continue;
    switch (arg) {
      case '--workspace':
      case '-w':
        options.workspaceId = rest[i + 1] ?? '';
        i += 1;
        break;
      case '--config':
      case '-c':
        options.configPath = rest[i + 1] ?? options.configPath;
        i += 1;
        break;
      case '--mode':
        options.mode = (rest[i + 1] ?? 'container') as 'container' | 'host';
        i += 1;
        break;
      case '--run-id':
        options.runId = rest[i + 1] ?? options.runId;
        i += 1;
        break;
      default:
        break;
    }
  }

  return { command, options };
}

function printUsage(): void {
  process.stderr.write(`Usage: emdash-run start --workspace <id> [--config path]\n`);
}

function loadConfig(configPath: string) {
  const absolute = resolve(process.cwd(), configPath);
  const raw = readFileSync(absolute, 'utf8');
  return JSON.parse(raw) as unknown;
}

async function runStart(options: StartCommandOptions): Promise<void> {
  if (!options.workspaceId) {
    throw new Error('Missing required --workspace argument');
  }

  const rawConfig = loadConfig(options.configPath);
  const resolvedConfig = resolveContainerConfig(rawConfig);

  const portManager = new PortManager();
  const events = await generateMockStartEvents({
    workspaceId: options.workspaceId,
    config: resolvedConfig,
    portAllocator: portManager,
    runId: options.runId,
    mode: options.mode,
  });

  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.command !== 'start') {
    printUsage();
    return;
  }

  try {
    await runStart(parsed.options);
  } catch (error) {
    if (error instanceof ContainerConfigError) {
      process.stderr.write(`Invalid config: ${error.message}\n`);
    } else if (error instanceof Error) {
      process.stderr.write(`${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

void main(process.argv.slice(2));
