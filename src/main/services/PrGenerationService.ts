import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { log } from '../lib/logger';
import { getProvider, PROVIDER_IDS, type ProviderId } from '../../shared/providers/registry';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface GeneratedPrContent {
  title: string;
  description: string;
}

/**
 * Generates PR title and description using available CLI agents or fallback heuristics
 */
export class PrGenerationService {
  /**
   * Generate PR title and description based on git changes
   * @param workspacePath - Path to the workspace
   * @param baseBranch - Base branch to compare against (default: 'main')
   * @param preferredProviderId - Optional provider ID to use first (e.g., from workspace.agentId)
   */
  async generatePrContent(
    workspacePath: string,
    baseBranch: string = 'main',
    preferredProviderId?: string | null
  ): Promise<GeneratedPrContent> {
    try {
      // Get git diff and commit messages
      const { diff, commits, changedFiles } = await this.getGitContext(workspacePath, baseBranch);

      if (!diff && commits.length === 0) {
        return this.generateFallbackContent(changedFiles);
      }

      // Try the workspace's provider first if specified
      if (preferredProviderId && this.isValidProviderId(preferredProviderId)) {
        try {
          const preferredResult = await this.generateWithProvider(
            preferredProviderId as ProviderId,
            workspacePath,
            diff,
            commits
          );
          if (preferredResult) {
            log.info(`Generated PR content with workspace provider: ${preferredProviderId}`);
            return preferredResult;
          }
        } catch (error) {
          log.debug(
            `Workspace provider ${preferredProviderId} generation failed, trying fallbacks`,
            {
              error,
            }
          );
        }
      }

      // Try Claude Code as fallback (preferred default)
      try {
        const claudeResult = await this.generateWithProvider(
          'claude',
          workspacePath,
          diff,
          commits
        );
        if (claudeResult) {
          log.info('Generated PR content with Claude Code');
          return claudeResult;
        }
      } catch (error) {
        log.debug('Claude Code generation failed, trying fallback', { error });
      }

      // Try Codex as fallback
      try {
        const codexResult = await this.generateWithProvider('codex', workspacePath, diff, commits);
        if (codexResult) {
          log.info('Generated PR content with Codex');
          return codexResult;
        }
      } catch (error) {
        log.debug('Codex generation failed, using heuristic fallback', { error });
      }

      // Fallback to heuristic-based generation
      return this.generateHeuristicContent(diff, commits, changedFiles);
    } catch (error) {
      log.error('Failed to generate PR content', { error });
      return this.generateFallbackContent([]);
    }
  }

  /**
   * Get git context (diff, commits, changed files) for PR generation
   */
  private async getGitContext(
    workspacePath: string,
    baseBranch: string
  ): Promise<{ diff: string; commits: string[]; changedFiles: string[] }> {
    let diff = '';
    let commits: string[] = [];
    let changedFiles: string[] = [];

    try {
      // Check if base branch exists (local or remote)
      let baseBranchExists = false;
      try {
        await execAsync(`git rev-parse --verify ${baseBranch}`, { cwd: workspacePath });
        baseBranchExists = true;
      } catch {
        try {
          await execAsync(`git rev-parse --verify origin/${baseBranch}`, { cwd: workspacePath });
          baseBranchExists = true;
          baseBranch = `origin/${baseBranch}`;
        } catch {
          // Base branch doesn't exist, will use working directory diff
        }
      }

      if (baseBranchExists) {
        // Get diff between base branch and current HEAD
        try {
          const { stdout: diffOut } = await execAsync(`git diff ${baseBranch}...HEAD --stat`, {
            cwd: workspacePath,
            maxBuffer: 10 * 1024 * 1024,
          });
          diff = diffOut || '';

          // Get list of changed files
          const { stdout: filesOut } = await execAsync(
            `git diff --name-only ${baseBranch}...HEAD`,
            { cwd: workspacePath }
          );
          changedFiles = (filesOut || '')
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);

          // Get commit messages
          const { stdout: commitsOut } = await execAsync(
            `git log ${baseBranch}..HEAD --pretty=format:"%s"`,
            { cwd: workspacePath }
          );
          commits = (commitsOut || '')
            .split('\n')
            .map((c) => c.trim())
            .filter(Boolean);
        } catch (error) {
          log.debug('Failed to get diff/commits from base branch', { error });
        }
      }

      // If no commits or diff from base branch, try to get diff of working directory
      if (commits.length === 0 && diff.length === 0) {
        try {
          const { stdout: workingDiff } = await execAsync('git diff --stat', {
            cwd: workspacePath,
            maxBuffer: 10 * 1024 * 1024,
          });
          diff = workingDiff || '';

          // Also get changed files from working directory
          const { stdout: filesOut } = await execAsync('git diff --name-only', {
            cwd: workspacePath,
          });
          changedFiles = (filesOut || '')
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);
        } catch {}
      }
    } catch (error) {
      log.warn('Failed to get git context', { error });
    }

    return { diff, commits, changedFiles };
  }

  /**
   * Generate PR content using a CLI provider (Claude Code or Codex)
   */
  private async generateWithProvider(
    providerId: ProviderId,
    workspacePath: string,
    diff: string,
    commits: string[]
  ): Promise<GeneratedPrContent | null> {
    const provider = getProvider(providerId);
    if (!provider || !provider.cli) {
      return null;
    }

    const cliCommand = provider.cli;
    if (!cliCommand) {
      return null;
    }

    // Check if provider CLI is available
    try {
      await execFileAsync(cliCommand, provider.versionArgs || ['--version'], {
        cwd: workspacePath,
      });
    } catch {
      log.debug(`Provider ${providerId} CLI not available`);
      return null;
    }

    // Build prompt for PR generation
    const prompt = this.buildPrGenerationPrompt(diff, commits);

    // Use spawn with stdin/stdout to invoke the CLI agent non-interactively
    // This uses the user's authenticated CLI agent (no API keys needed)
    return new Promise<GeneratedPrContent | null>((resolve) => {
      const timeout = 30000; // 30 second timeout
      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout;

      // Build command arguments
      const args: string[] = [];
      if (provider.defaultArgs?.length) {
        args.push(...provider.defaultArgs);
      }
      if (provider.autoApproveFlag) {
        args.push(provider.autoApproveFlag);
      }

      // Handle prompt: some providers accept it as a flag, others via stdin
      let promptViaStdin = true;
      if (provider.initialPromptFlag !== undefined && provider.initialPromptFlag !== '') {
        // Provider accepts prompt as command-line argument
        args.push(provider.initialPromptFlag);
        args.push(prompt);
        promptViaStdin = false;
      }

      // Spawn the provider CLI
      const child = spawn(cliCommand, args, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure we have a proper terminal environment
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        log.debug(`Provider ${providerId} invocation timed out`);
        resolve(null);
      }, timeout);

      // Collect stdout
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });
      }

      // Collect stderr (for debugging)
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });
      }

      // Handle process exit
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeoutId);

        if (code !== 0 && code !== null) {
          log.debug(`Provider ${providerId} exited with code ${code}`, { stderr });
          resolve(null);
          return;
        }

        if (signal) {
          log.debug(`Provider ${providerId} killed by signal ${signal}`);
          resolve(null);
          return;
        }

        // Try to parse the response
        const result = this.parseProviderResponse(stdout);
        if (result) {
          log.info(`Successfully generated PR content with ${providerId}`);
          resolve(result);
        } else {
          log.debug(`Failed to parse response from ${providerId}`, { stdout, stderr });
          resolve(null);
        }
      });

      // Handle errors
      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        log.debug(`Failed to spawn ${providerId}`, { error });
        resolve(null);
      });

      // Send prompt via stdin if needed
      // Claude Code and Codex accept prompts via stdin (initialPromptFlag is empty string)
      if (promptViaStdin) {
        try {
          if (child.stdin) {
            // Write the prompt
            child.stdin.write(prompt);
            // Add a newline to ensure the prompt is processed
            child.stdin.write('\n');
            // Close stdin to signal EOF - this should make the CLI process the prompt and exit
            child.stdin.end();
          }
        } catch (error) {
          clearTimeout(timeoutId);
          try {
            child.kill();
          } catch {}
          log.debug(`Failed to write prompt to ${providerId}`, { error });
          resolve(null);
        }
      } else {
        // Prompt was passed as command-line argument, just close stdin
        if (child.stdin) {
          child.stdin.end();
        }
      }
    });
  }

  /**
   * Build prompt for PR generation
   */
  private buildPrGenerationPrompt(diff: string, commits: string[]): string {
    const commitContext =
      commits.length > 0 ? `\n\nCommits:\n${commits.map((c) => `- ${c}`).join('\n')}` : '';
    const diffContext = diff
      ? `\n\nDiff summary:\n${diff.substring(0, 2000)}${diff.length > 2000 ? '...' : ''}`
      : '';

    return `Generate a concise PR title and description based on these changes:

${commitContext}${diffContext}

Please respond in the following JSON format:
{
  "title": "A concise PR title (max 72 chars, use conventional commit format if applicable)",
  "description": "A clear description of what this PR does, why it's needed, and any important context"
}

Only respond with valid JSON, no other text.`;
  }

  /**
   * Parse provider response into PR content
   */
  private parseProviderResponse(response: string): GeneratedPrContent | null {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.title && parsed.description) {
          return {
            title: parsed.title.trim(),
            description: parsed.description.trim(),
          };
        }
      }
    } catch (error) {
      log.debug('Failed to parse provider response', { error, response });
    }
    return null;
  }

  /**
   * Generate PR content using heuristics based on commits and files
   */
  private generateHeuristicContent(
    diff: string,
    commits: string[],
    changedFiles: string[]
  ): GeneratedPrContent {
    // Use first commit message as title if available (best case)
    let title = 'chore: update code';
    if (commits.length > 0) {
      // Use the most recent commit message as title
      title = commits[0];

      // Clean up common prefixes that might not be needed in PR title
      title = title.replace(
        /^(feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert):\s*/i,
        ''
      );

      // Ensure title is not too long (GitHub PR title limit is ~72 chars)
      if (title.length > 72) {
        title = title.substring(0, 69) + '...';
      }

      // Re-add conventional commit prefix if it was there
      const firstCommit = commits[0];
      const prefixMatch = firstCommit.match(
        /^(feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert):/i
      );
      if (prefixMatch && !title.startsWith(prefixMatch[1])) {
        title = `${prefixMatch[1]}: ${title}`;
      }
    } else if (changedFiles.length > 0) {
      // Generate title from file changes when no commits available
      const mainFile = changedFiles[0];
      const fileParts = mainFile.split('/');
      const fileName = fileParts[fileParts.length - 1];
      const baseName = fileName.replace(/\.[^.]*$/, ''); // Remove extension

      // Analyze file patterns to infer intent
      if (fileName.match(/test|spec/i)) {
        title = 'test: add tests';
      } else if (fileName.match(/fix|bug|error/i)) {
        title = 'fix: resolve issue';
      } else if (fileName.match(/feat|feature|add/i)) {
        title = 'feat: add feature';
      } else if (baseName.match(/^[A-Z]/)) {
        // Capitalized files often indicate new components/features
        title = `feat: add ${baseName}`;
      } else {
        title = `chore: update ${baseName || fileName}`;
      }
    }

    // Generate description from commits and files
    const descriptionParts: string[] = [];

    // Extract diff stats first
    let fileCount = 0;
    let insertions = 0;
    let deletions = 0;
    if (diff) {
      const statsMatch = diff.match(
        /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
      );
      if (statsMatch) {
        fileCount = parseInt(statsMatch[1] || '0', 10) || 0;
        insertions = parseInt(statsMatch[2] || '0', 10) || 0;
        deletions = parseInt(statsMatch[3] || '0', 10) || 0;
      }
    }
    // Fallback to changedFiles length if no diff stats
    if (fileCount === 0 && changedFiles.length > 0) {
      fileCount = changedFiles.length;
    }

    // Add commits section if available
    if (commits.length > 0) {
      descriptionParts.push('## Changes');
      commits.forEach((commit) => {
        descriptionParts.push(`- ${commit}`);
      });
    }

    // Add files section - only show if more than 1 file or if we have detailed stats
    if (changedFiles.length > 0) {
      if (changedFiles.length === 1 && fileCount === 1) {
        // Single file: include it inline with summary
        descriptionParts.push('\n## Summary');
        descriptionParts.push(`- Updated \`${changedFiles[0]}\``);
        if (insertions > 0 || deletions > 0) {
          const changes: string[] = [];
          if (insertions > 0) changes.push(`+${insertions}`);
          if (deletions > 0) changes.push(`-${deletions}`);
          if (changes.length > 0) {
            descriptionParts.push(`- ${changes.join(', ')} lines`);
          }
        }
      } else {
        // Multiple files: show list
        descriptionParts.push('\n## Files Changed');
        changedFiles.slice(0, 20).forEach((file) => {
          descriptionParts.push(`- \`${file}\``);
        });
        if (changedFiles.length > 20) {
          descriptionParts.push(`\n... and ${changedFiles.length - 20} more files`);
        }

        // Add summary stats if available
        if (fileCount > 0 || insertions > 0 || deletions > 0) {
          descriptionParts.push('\n## Summary');
          if (fileCount > 0) {
            descriptionParts.push(`- ${fileCount} file${fileCount !== 1 ? 's' : ''} changed`);
          }
          if (insertions > 0 || deletions > 0) {
            const changes: string[] = [];
            if (insertions > 0) changes.push(`+${insertions}`);
            if (deletions > 0) changes.push(`-${deletions}`);
            descriptionParts.push(`- ${changes.join(', ')} lines`);
          }
        }
      }
    } else if (fileCount > 0 || insertions > 0 || deletions > 0) {
      // No file list but we have stats
      descriptionParts.push('\n## Summary');
      if (fileCount > 0) {
        descriptionParts.push(`- ${fileCount} file${fileCount !== 1 ? 's' : ''} changed`);
      }
      if (insertions > 0 || deletions > 0) {
        const changes: string[] = [];
        if (insertions > 0) changes.push(`+${insertions}`);
        if (deletions > 0) changes.push(`-${deletions}`);
        descriptionParts.push(`- ${changes.join(', ')} lines`);
      }
    }

    const description = descriptionParts.join('\n') || 'No description available.';

    return { title, description };
  }

  /**
   * Generate fallback content when no context is available
   */
  private generateFallbackContent(changedFiles: string[]): GeneratedPrContent {
    const title =
      changedFiles.length > 0
        ? `chore: update ${changedFiles[0].split('/').pop() || 'files'}`
        : 'chore: update code';

    const description =
      changedFiles.length > 0
        ? `Updated ${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''}.`
        : 'No changes detected.';

    return { title, description };
  }

  /**
   * Check if a string is a valid provider ID
   */
  private isValidProviderId(id: string): id is ProviderId {
    return PROVIDER_IDS.includes(id as ProviderId);
  }
}

export const prGenerationService = new PrGenerationService();
