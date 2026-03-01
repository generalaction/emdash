import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { log } from '../lib/logger';
import { getProvider, PROVIDER_IDS, type ProviderId } from '../../shared/providers/registry';

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
   * @param taskPath - Path to the task
   * @param baseBranch - Base branch to compare against (default: 'main')
   * @param preferredProviderId - Optional provider ID to use first (e.g., from task.agentId)
   */
  async generatePrContent(
    taskPath: string,
    baseBranch: string = 'main',
    preferredProviderId?: string | null
  ): Promise<GeneratedPrContent> {
    try {
      // Get git diff and commit messages
      const { diff, commits, changedFiles } = await this.getGitContext(taskPath, baseBranch);

      if (!diff && commits.length === 0) {
        return this.generateFallbackContent(changedFiles);
      }

      // Try the task's provider first if specified
      if (preferredProviderId && this.isValidProviderId(preferredProviderId)) {
        try {
          const preferredResult = await this.generateWithProvider(
            preferredProviderId as ProviderId,
            taskPath,
            diff,
            commits
          );
          if (preferredResult) {
            log.info(`Generated PR content with task provider: ${preferredProviderId}`);
            return {
              title: preferredResult.title,
              description: this.normalizeMarkdown(preferredResult.description),
            };
          }
        } catch (error) {
          log.debug(`Task provider ${preferredProviderId} generation failed, trying fallbacks`, {
            error,
          });
        }
      }

      // Try Claude Code as fallback (preferred default)
      try {
        const claudeResult = await this.generateWithProvider('claude', taskPath, diff, commits);
        if (claudeResult) {
          log.info('Generated PR content with Claude Code');
          return {
            title: claudeResult.title,
            description: this.normalizeMarkdown(claudeResult.description),
          };
        }
      } catch (error) {
        log.debug('Claude Code generation failed, trying fallback', { error });
      }

      // Try Codex as fallback
      try {
        const codexResult = await this.generateWithProvider('codex', taskPath, diff, commits);
        if (codexResult) {
          log.info('Generated PR content with Codex');
          return {
            title: codexResult.title,
            description: this.normalizeMarkdown(codexResult.description),
          };
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
    taskPath: string,
    baseBranch: string
  ): Promise<{ diff: string; commits: string[]; changedFiles: string[] }> {
    let diff = '';
    let commits: string[] = [];
    let changedFiles: string[] = [];

    try {
      // Fetch remote to ensure we have latest state (prevents comparing against stale local branches)
      // This is critical: if local main is behind remote, we'd incorrectly include others' commits
      // Only fetch if remote exists
      try {
        await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: taskPath });
        // Remote exists, try to fetch
        try {
          await execFileAsync('git', ['fetch', 'origin', '--quiet'], { cwd: taskPath });
        } catch (fetchError) {
          log.debug('Failed to fetch remote, continuing with existing refs', { fetchError });
        }
      } catch {
        // Remote doesn't exist, skip fetch
        log.debug('Remote origin not found, skipping fetch');
      }

      // Always prefer remote branch to avoid stale local branch issues
      let baseBranchRef = baseBranch;
      let baseBranchExists = false;

      // First try remote branch (most reliable - always up to date)
      try {
        await execFileAsync('git', ['rev-parse', '--verify', `origin/${baseBranch}`], {
          cwd: taskPath,
        });
        baseBranchExists = true;
        baseBranchRef = `origin/${baseBranch}`;
      } catch {
        // Fall back to local branch only if remote doesn't exist
        try {
          await execFileAsync('git', ['rev-parse', '--verify', baseBranch], { cwd: taskPath });
          baseBranchExists = true;
          baseBranchRef = baseBranch;
        } catch {
          // Base branch doesn't exist, will use working directory diff
        }
      }

      if (baseBranchExists) {
        // Get diff between base branch and current HEAD (committed changes)
        try {
          const { stdout: diffOut } = await execFileAsync(
            'git',
            ['diff', `${baseBranchRef}...HEAD`, '--stat'],
            { cwd: taskPath, maxBuffer: 10 * 1024 * 1024 }
          );
          diff = diffOut || '';

          // Get list of changed files from commits
          const { stdout: filesOut } = await execFileAsync(
            'git',
            ['diff', '--name-only', `${baseBranchRef}...HEAD`],
            { cwd: taskPath }
          );
          const committedFiles = (filesOut || '')
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);
          changedFiles.push(...committedFiles);

          // Get commit messages
          const { stdout: commitsOut } = await execFileAsync(
            'git',
            ['log', `${baseBranchRef}..HEAD`, '--pretty=format:%s'],
            { cwd: taskPath }
          );
          commits = (commitsOut || '')
            .split('\n')
            .map((c) => c.trim())
            .filter(Boolean);
        } catch (error) {
          log.debug('Failed to get diff/commits from base branch', { error });
        }
      }

      // Also include uncommitted changes (working directory) to capture all changes
      // This ensures PR description includes changes that will be committed
      try {
        const { stdout: workingDiff } = await execFileAsync('git', ['diff', '--stat'], {
          cwd: taskPath,
          maxBuffer: 10 * 1024 * 1024,
        });
        const workingDiffText = workingDiff || '';

        // If we have both committed and uncommitted changes, combine them
        if (workingDiffText && diff) {
          // Combine diff stats (working directory changes will be added)
          diff = `${diff}\n${workingDiffText}`;
        } else if (workingDiffText && !diff) {
          // Only uncommitted changes
          diff = workingDiffText;
        }

        // Get uncommitted changed files and merge with committed files
        const { stdout: filesOut } = await execFileAsync('git', ['diff', '--name-only'], {
          cwd: taskPath,
        });
        const uncommittedFiles = (filesOut || '')
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean);

        // Merge file lists, avoiding duplicates
        const allFiles = new Set([...changedFiles, ...uncommittedFiles]);
        changedFiles = Array.from(allFiles);
      } catch (error) {
        log.debug('Failed to get working directory diff', { error });
      }

      // Fallback: if we still have no diff or commits, try staged changes
      if (commits.length === 0 && diff.length === 0) {
        try {
          const { stdout: stagedDiff } = await execFileAsync(
            'git',
            ['diff', '--cached', '--stat'],
            { cwd: taskPath, maxBuffer: 10 * 1024 * 1024 }
          );
          if (stagedDiff) {
            diff = stagedDiff;
            const { stdout: filesOut } = await execFileAsync(
              'git',
              ['diff', '--cached', '--name-only'],
              { cwd: taskPath }
            );
            changedFiles = (filesOut || '')
              .split('\n')
              .map((f) => f.trim())
              .filter(Boolean);
          }
        } catch {}
      }
    } catch (error) {
      log.warn('Failed to get git context', { error });
    }

    return { diff, commits, changedFiles };
  }

  /**
   * Generate PR content using a CLI provider (Claude Code or Codex)
   * Retries once on parse failure (exit code 0 but malformed output).
   */
  private async generateWithProvider(
    providerId: ProviderId,
    taskPath: string,
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
        cwd: taskPath,
      });
    } catch {
      log.debug(`Provider ${providerId} CLI not available`);
      return null;
    }

    // Build prompt for PR generation
    const prompt = this.buildPrGenerationPrompt(diff, commits);

    // Try up to 2 times: retry once if the process succeeded but JSON parsing failed
    for (let attempt = 0; attempt < 2; attempt++) {
      const { result, shouldRetry } = await this.spawnProvider(
        providerId,
        cliCommand,
        provider,
        taskPath,
        prompt
      );
      if (result) return result;
      if (!shouldRetry) break;
      log.debug(`Retrying provider ${providerId} (attempt ${attempt + 2}/2) after parse failure`);
    }

    return null;
  }

  /**
   * Spawn a provider CLI process and collect its output.
   * Returns the parsed result (if any) and whether a retry is worthwhile.
   */
  private spawnProvider(
    providerId: ProviderId,
    cliCommand: string,
    provider: ReturnType<typeof getProvider>,
    taskPath: string,
    prompt: string
  ): Promise<{ result: GeneratedPrContent | null; shouldRetry: boolean }> {
    return new Promise((resolve) => {
      const timeout = 60000;
      let stdout = '';
      let stderr = '';
      let resolved = false;

      const done = (result: GeneratedPrContent | null, shouldRetry: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve({ result, shouldRetry });
      };

      // Build command arguments — Claude Code gets special `-p` (print) mode
      const args: string[] = [];
      const isClaudeProvider = providerId === 'claude';

      if (isClaudeProvider) {
        // Use -p (print/non-interactive) mode with structured JSON output.
        // This eliminates ANSI escapes, progress indicators, and TUI noise.
        args.push('-p', prompt, '--output-format', 'json');
        if (provider!.autoApproveFlag) {
          args.push(provider!.autoApproveFlag);
        }
      } else {
        if (provider!.defaultArgs?.length) {
          args.push(...provider!.defaultArgs);
        }
        if (provider!.autoApproveFlag) {
          args.push(provider!.autoApproveFlag);
        }
      }

      // Handle prompt for non-Claude providers: some accept it as a flag, others via stdin
      let promptViaStdin = false;
      if (!isClaudeProvider) {
        if (provider!.initialPromptFlag !== undefined && provider!.initialPromptFlag !== '') {
          args.push(provider!.initialPromptFlag);
          args.push(prompt);
        } else {
          promptViaStdin = true;
        }
      }

      // Spawn the provider CLI
      const child = spawn(cliCommand, args, {
        cwd: taskPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        log.debug(`Provider ${providerId} invocation timed out`);
        done(null, false); // Don't retry on timeout
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
          done(null, false); // Don't retry on non-zero exit
          return;
        }

        if (signal) {
          log.debug(`Provider ${providerId} killed by signal ${signal}`);
          done(null, false);
          return;
        }

        // Try to parse the response
        const result = this.parseProviderResponse(stdout);
        if (result) {
          log.info(`Successfully generated PR content with ${providerId}`);
          done(result, false);
        } else {
          log.debug(`Failed to parse response from ${providerId}`, { stdout, stderr });
          done(null, true); // Retry — process succeeded but parsing failed
        }
      });

      // Handle errors
      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        log.debug(`Failed to spawn ${providerId}`, { error });
        done(null, false); // Don't retry on spawn failure
      });

      // Send prompt via stdin if needed (non-Claude providers with no initialPromptFlag)
      if (promptViaStdin) {
        try {
          if (child.stdin) {
            child.stdin.write(prompt);
            child.stdin.write('\n');
            child.stdin.end();
          }
        } catch (error) {
          clearTimeout(timeoutId);
          try {
            child.kill();
          } catch {}
          log.debug(`Failed to write prompt to ${providerId}`, { error });
          done(null, false);
        }
      } else {
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

Respond with ONLY valid JSON — no markdown fences, no preamble, no explanation. Your entire response must be exactly one JSON object:
{
  "title": "A concise PR title (max 72 chars, use conventional commit format if applicable)",
  "description": "A well-structured markdown description using proper markdown formatting. Use ## for section headers, - or * for lists, \`code\` for inline code, and proper line breaks.\n\nUse actual newlines (\\n in JSON) for line breaks, not literal \\n text. Keep it straightforward and to the point."
}`;
  }

  /**
   * Strip ANSI escape sequences from a string
   */
  private stripAnsi(text: string): string {
    // Covers CSI sequences, OSC sequences, and other common escape codes
    // eslint-disable-next-line no-control-regex
    return text.replace(
      /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[^[(\x1b]*?[a-zA-Z]/g,
      ''
    );
  }

  /**
   * Parse provider response into PR content.
   *
   * Multi-step extraction:
   * 1. Strip ANSI escape sequences
   * 2. If output is a Claude --output-format json envelope, extract the result field
   * 3. Strip markdown code fences
   * 4. Try to find a JSON object containing both "title" and "description" keys
   * 5. Fall back to greedy match
   */
  private parseProviderResponse(response: string): GeneratedPrContent | null {
    try {
      // Step 1: Strip ANSI escape sequences
      let text = this.stripAnsi(response);

      // Step 2: If this is a Claude --output-format json envelope, extract the result field
      try {
        const envelope = JSON.parse(text);
        if (envelope && typeof envelope.result === 'string') {
          text = envelope.result;
        }
      } catch {
        // Not a valid JSON envelope — continue with raw text
      }

      // Step 3: Strip markdown code fences (```json ... ``` or ``` ... ```)
      text = text.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g, '$1');

      // Step 4: Try to find a JSON object containing both "title" and "description"
      const specificMatch = text.match(/\{[^{}]*"title"[^{}]*"description"[^{}]*\}/s);
      // Also try reversed key order
      const reversedMatch =
        !specificMatch && text.match(/\{[^{}]*"description"[^{}]*"title"[^{}]*\}/s);
      const jsonStr = specificMatch?.[0] ?? reversedMatch?.[0];

      // Step 5: Fall back to greedy match only if specific match failed
      const fallbackStr = jsonStr ?? text.match(/\{[\s\S]*\}/)?.[0];

      if (fallbackStr) {
        const parsed = JSON.parse(fallbackStr);
        if (parsed.title && parsed.description) {
          let description = String(parsed.description);

          // Handle multiple newline escape scenarios:
          // 1. Literal backslash-n sequences (from double-escaped JSON like "\\n")
          if (description.includes('\\n')) {
            description = description.replace(/\\n/g, '\n');
          }
          // 2. Double-backslash newlines
          description = description.replace(/\\\\n/g, '\n');

          description = description.trim();

          return {
            title: parsed.title.trim(),
            description,
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
   * Normalize markdown formatting to ensure proper structure
   */
  private normalizeMarkdown(text: string): string {
    if (!text) return text;

    // Ensure headers have proper spacing (double newline before headers)
    let normalized = text.replace(/\n(##+ )/g, '\n\n$1');

    // Remove excessive blank lines (more than 2 consecutive)
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    // Trim trailing whitespace on each line but preserve intentional spacing
    normalized = normalized
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');

    return normalized.trim();
  }

  /**
   * Check if a string is a valid provider ID
   */
  private isValidProviderId(id: string): id is ProviderId {
    return PROVIDER_IDS.includes(id as ProviderId);
  }
}

export const prGenerationService = new PrGenerationService();
