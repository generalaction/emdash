/**
 * Custom slash command support for ACP agents
 *
 * This module provides functionality to scan for user-created slash commands
 * in agent-specific directories, allowing Emdash to show only custom commands
 * rather than built-in ones.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderId } from './registry';
import TOML from '@iarna/toml';

/**
 * Logger interface for dependency injection
 */
export type Logger = {
  debug: (label: string, data?: Record<string, unknown>) => void;
  error: (label: string, data?: Record<string, unknown>) => void;
};

/**
 * A custom slash command discovered from the filesystem
 */
export interface CustomSlashCommand {
  /** Command name (filename without extension) */
  name: string;
  /** Human-readable description (extracted from file content) */
  description?: string;
  /** Whether this is a project-level or global command */
  source: 'project' | 'global';
  /** The provider this command belongs to */
  provider: ProviderId;
  /** Full file path for debugging/reference */
  filePath: string;
}

/**
 * Configuration for where to find custom commands for each provider
 */
export interface CommandDirectoryConfig {
  /** The provider ID */
  provider: ProviderId;
  /** Project-relative directories where commands are stored (scans all) */
  projectDirs: string[];
  /** Global directories (relative to home dir, without ~/ prefix) where commands are stored (scans all) */
  globalDirs: string[];
  /** File extension for command files */
  extension: string;
}

/**
 * Known command directories for each ACP provider
 */
export const COMMAND_DIRECTORIES: Partial<Record<ProviderId, CommandDirectoryConfig>> = {
  codex: {
    provider: 'codex',
    projectDirs: ['.codex/prompts', '.codex/commands'],
    globalDirs: ['.codex/prompts', '.codex/commands'],
    extension: '.md',
  },
  claude: {
    provider: 'claude',
    projectDirs: ['.claude/commands'],
    globalDirs: ['.claude/commands'],
    extension: '.md',
  },
  gemini: {
    provider: 'gemini',
    projectDirs: ['.gemini/commands'],
    globalDirs: ['.gemini/commands'],
    extension: '.toml',
  },
  // Note: Other providers (cursor, etc.) can be added here when their
  // custom command directories are known
};

/**
 * Read directory and return files matching the extension
 */
async function readDirectory(dirPath: string, extension: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name);
    return files;
  } catch (error: unknown) {
    // Directory doesn't exist or isn't readable - not an error
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'EACCES')
    ) {
      return [];
    }
    throw error;
  }
}

/**
 * Read file content and extract description
 *
 * For .md files, tries to find:
 * 1. First heading (# Title)
 * 2. First line (if short)
 *
 * For .toml files, parses TOML and looks for a description field
 */
function extractDescription(content: string, extension: string, logger?: Logger): string | undefined {
  // Handle TOML files
  if (extension === '.toml') {
    try {
      const parsed = TOML.parse(content) as Record<string, unknown>;
      if (typeof parsed.description === 'string') {
        return parsed.description;
      }
    } catch (error: unknown) {
      // If TOML parsing fails, log the error and fall through to generic text handling
      logger?.error('customCommands:toml:parseFailed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    // Fall through to text-based extraction if TOML parsing fails or no description found
  }

  // Handle Markdown and other text files
  const lines = content.split('\n').map((l) => l.trim());

  for (const line of lines) {
    if (!line) continue;

    // Check for # heading (Markdown)
    if (line.startsWith('#')) {
      return line.substring(1).trim();
    }

    // Use first non-empty line as description (if short enough)
    if (line.length < 100 && line.length > 0) {
      return line;
    }

    break;
  }

  return undefined;
}

/**
 * Scan for custom slash commands in a directory
 */
async function scanCommandsDirectory(
  dirPath: string,
  source: 'project' | 'global',
  provider: ProviderId,
  extension: string,
  logger?: Logger
): Promise<CustomSlashCommand[]> {
  const commands: CustomSlashCommand[] = [];
  const files = await readDirectory(dirPath, extension);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      // Use path.parse().name to robustly extract filename without extension
      const name = path.parse(file).name;
      const description = extractDescription(content, extension, logger);

      commands.push({
        name,
        description,
        source,
        provider,
        filePath,
      });
    } catch (error: unknown) {
      // Skip files we can't read, but log for debugging
      logger?.error('customCommands:file:readFailed', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return commands;
}

/**
 * Scan for custom slash commands for a specific provider
 *
 * @param projectPath - The project root directory
 * @param providerId - The provider to scan commands for
 * @param logger - Optional logger for error reporting
 * @returns Array of custom commands (both project and global)
 */
export async function scanCustomCommands(
  projectPath: string,
  providerId: ProviderId,
  logger?: Logger
): Promise<CustomSlashCommand[]> {
  const config = COMMAND_DIRECTORIES[providerId];
  if (!config) {
    return [];
  }

  // Scan all project directories in parallel
  const projectCommandArrays = await Promise.all(
    config.projectDirs.map((projectDir) =>
      scanCommandsDirectory(
        path.join(projectPath, projectDir),
        'project',
        providerId,
        config.extension,
        logger
      )
    )
  );
  const commands = projectCommandArrays.flat();

  // Scan all global directories in parallel
  const globalCommandArrays = await Promise.all(
    config.globalDirs.map((globalDir) =>
      scanCommandsDirectory(
        path.join(os.homedir(), globalDir),
        'global',
        providerId,
        config.extension,
        logger
      )
    )
  );
  const allGlobalCommands = globalCommandArrays.flat();

  // Filter out global commands that are overridden by project commands
  for (const globalCmd of allGlobalCommands) {
    if (!commands.some((c) => c.name === globalCmd.name)) {
      commands.push(globalCmd);
    }
  }

  return commands;
}

/**
 * Get all providers that support custom commands
 */
export function getProvidersWithCustomCommands(): ProviderId[] {
  return Object.keys(COMMAND_DIRECTORIES) as ProviderId[];
}
