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

export interface GeneratedCommitMessage {
  message: string;
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
   * Generate a commit message based on staged changes
   * @param taskPath - Path to the task/repo
   * @param preferredProviderId - Optional provider ID to use first (e.g., from task.agentId)
   */
  async generateCommitMessage(
    taskPath: string,
    preferredProviderId?: string | null
  ): Promise<GeneratedCommitMessage> {
    try {
      // Get staged files and their diff
      const { stagedFiles, diff } = await this.getStagedContext(taskPath);

      if (stagedFiles.length === 0) {
        return { message: 'chore: apply task changes' };
      }

      // Try the task's provider first if specified
      if (preferredProviderId && this.isValidProviderId(preferredProviderId)) {
        try {
          const result = await this.generateCommitMessageWithProvider(
            preferredProviderId as ProviderId,
            taskPath,
            stagedFiles,
            diff
          );
          if (result) {
            log.info(`Generated commit message with task provider: ${preferredProviderId}`);
            return result;
          }
        } catch (error) {
          log.debug(`Task provider ${preferredProviderId} commit message generation failed`, {
            error,
          });
        }
      }

      // Try Claude Code as fallback
      try {
        const claudeResult = await this.generateCommitMessageWithProvider(
          'claude',
          taskPath,
          stagedFiles,
          diff
        );
        if (claudeResult) {
          log.info('Generated commit message with Claude Code');
          return claudeResult;
        }
      } catch (error) {
        log.debug('Claude Code commit message generation failed', { error });
      }

      // Try Codex as fallback
      try {
        const codexResult = await this.generateCommitMessageWithProvider(
          'codex',
          taskPath,
          stagedFiles,
          diff
        );
        if (codexResult) {
          log.info('Generated commit message with Codex');
          return codexResult;
        }
      } catch (error) {
        log.debug('Codex commit message generation failed', { error });
      }

      // Fall back to heuristic-based generation
      log.debug('Falling back to heuristic commit message generation');
      return this.generateCommitMessageFromFiles(stagedFiles, diff);
    } catch (error) {
      log.error('Failed to generate commit message', { error });
      return { message: 'chore: apply task changes' };
    }
  }

  /**
   * Generate commit message using a CLI provider
   */
  private async generateCommitMessageWithProvider(
    providerId: ProviderId,
    taskPath: string,
    stagedFiles: string[],
    diff: string
  ): Promise<GeneratedCommitMessage | null> {
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
      log.debug(`Provider ${providerId} CLI not available for commit message generation`);
      return null;
    }

    // Build prompt for commit message generation
    const prompt = this.buildCommitMessagePrompt(stagedFiles, diff);

    return new Promise<GeneratedCommitMessage | null>((resolve) => {
      const timeout = 30000; // 30 second timeout
      let stdout = '';
      let stderr = '';

      const args: string[] = [];
      if (provider.defaultArgs?.length) {
        args.push(...provider.defaultArgs);
      }
      if (provider.autoApproveFlag) {
        args.push(provider.autoApproveFlag);
      }

      let promptViaStdin = true;
      if (provider.initialPromptFlag !== undefined && provider.initialPromptFlag !== '') {
        args.push(provider.initialPromptFlag);
        args.push(prompt);
        promptViaStdin = false;
      }

      const child = spawn(cliCommand, args, {
        cwd: taskPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      const timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        log.debug(`Provider ${providerId} commit message generation timed out`);
        resolve(null);
      }, timeout);

      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });
      }

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

        const result = this.parseCommitMessageResponse(stdout);
        if (result) {
          log.info(`Successfully generated commit message with ${providerId}`);
          resolve(result);
        } else {
          log.debug(`Failed to parse commit message from ${providerId}`, { stdout, stderr });
          resolve(null);
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        log.debug(`Failed to spawn ${providerId} for commit message`, { error });
        resolve(null);
      });

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
          resolve(null);
        }
      } else {
        if (child.stdin) {
          child.stdin.end();
        }
      }
    });
  }

  /**
   * Build prompt for commit message generation
   */
  private buildCommitMessagePrompt(stagedFiles: string[], diff: string): string {
    const filesContext = `Files to be committed:\n${stagedFiles.map((f) => `- ${f}`).join('\n')}`;
    const diffContext = diff
      ? `\n\nDiff summary:\n${diff.substring(0, 2000)}${diff.length > 2000 ? '...' : ''}`
      : '';

    return `Generate a concise git commit message for these staged changes:

${filesContext}${diffContext}

Requirements:
- Use conventional commit format (e.g., feat:, fix:, chore:, docs:, refactor:, test:)
- Keep the message under 72 characters
- Be specific about what changed
- Focus on the "what" and "why", not the "how"

Respond with ONLY the commit message text, nothing else. No quotes, no explanation, just the commit message.`;
  }

  /**
   * Returns true if the first line looks like an LLM explanation prefix rather than a commit message.
   */
  private looksLikeExplanation(firstLine: string): boolean {
    const lower = firstLine.toLowerCase();
    const patterns = [
      'here is',
      'i suggest',
      'suggested message:',
      'the commit message is',
      'suggested commit message:',
    ];
    return patterns.some((p) => lower.includes(p));
  }

  /**
   * Parse commit message from provider response
   */
  private parseCommitMessageResponse(response: string): GeneratedCommitMessage | null {
    if (!response) return null;

    // Clean up the response - remove any markdown formatting, quotes, etc.
    let message = response.trim();

    // Remove common wrapper patterns
    message = message.replace(/^["'`]+|["'`]+$/g, ''); // Remove quotes
    message = message.replace(/^```[\s\S]*?\n?|```$/g, ''); // Remove code blocks
    message = message.trim();

    // Take only the first line if multiple lines
    const firstLine = message.split('\n')[0]?.trim();
    if (!firstLine) return null;

    // Validate it looks like a commit message (not an explanation)
    if (firstLine.length > 100) return null; // Too long, probably explanation
    if (this.looksLikeExplanation(firstLine)) return null;

    // Ensure it's not empty after cleaning
    if (firstLine.length === 0) return null;

    // Truncate if needed
    const finalMessage = firstLine.length > 72 ? firstLine.substring(0, 69) + '...' : firstLine;

    return { message: finalMessage };
  }

  /**
   * Get context for staged changes
   */
  private async getStagedContext(
    taskPath: string
  ): Promise<{ stagedFiles: string[]; diff: string }> {
    let stagedFiles: string[] = [];
    let diff = '';

    try {
      // Get list of staged files
      const { stdout: filesOut } = await execAsync('git diff --cached --name-only', {
        cwd: taskPath,
      });
      stagedFiles = (filesOut || '')
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);

      // Get diff stat for staged changes
      const { stdout: diffOut } = await execAsync('git diff --cached --stat', {
        cwd: taskPath,
        maxBuffer: 10 * 1024 * 1024,
      });
      diff = diffOut || '';
    } catch (error) {
      log.debug('Failed to get staged context', { error });
    }

    return { stagedFiles, diff };
  }

  /**
   * Returns the scope for a single file path (e.g. "Button" from "src/components/Button/Button.tsx").
   */
  private scopeFromPath(filePath: string): string {
    const pathParts = filePath.split('/');
    if (pathParts.length < 2) return '';
    const commonDirs = [
      'components',
      'services',
      'hooks',
      'utils',
      'lib',
      'api',
      'pages',
      'routes',
    ];
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (commonDirs.includes(pathParts[i]) && pathParts[i + 1]) {
        return pathParts[i + 1].replace(/\.[^.]*$/, '');
      }
    }
    return '';
  }

  /**
   * Returns the scope that appears most often in the given file paths; on tie, first occurrence wins.
   */
  private majorityScope(filePaths: string[]): string {
    const counts: Record<string, number> = {};
    let firstScope = '';
    for (const filePath of filePaths) {
      const scope = this.scopeFromPath(filePath);
      if (!scope) continue;
      if (!firstScope) firstScope = scope;
      counts[scope] = (counts[scope] ?? 0) + 1;
    }
    let bestScope = '';
    let bestCount = 0;
    for (const [scope, count] of Object.entries(counts)) {
      if (count > bestCount) {
        bestCount = count;
        bestScope = scope;
      }
    }
    return bestScope;
  }

  /**
   * Generate commit message from file list and diff
   */
  private generateCommitMessageFromFiles(files: string[], diff: string): GeneratedCommitMessage {
    // Determine the primary type of change based on files
    // Order matters: more specific patterns should come first
    const filePatterns: Array<{ type: string; pattern: RegExp }> = [
      { type: 'test', pattern: /\.(test|spec)\.(ts|tsx|js|jsx)$|__tests__|\/test\//i },
      { type: 'ci', pattern: /\.github\/|\.gitlab-ci|Jenkinsfile|\.circleci/i },
      { type: 'docs', pattern: /\.(md|mdx|txt)$|README|CHANGELOG|docs\//i },
      { type: 'style', pattern: /\.(css|scss|sass|less)$|\.styled\.(ts|tsx|js|jsx)$|styles?\//i },
      { type: 'config', pattern: /\.(json|yml|yaml|toml|config\.(ts|js))$|\..*rc$/i },
    ];

    // Analyze files to determine commit type
    let commitType = 'chore';
    let scope = '';
    let subject = '';

    // Count file types
    const typeCounts: Record<string, number> = {
      test: 0,
      docs: 0,
      config: 0,
      style: 0,
      ci: 0,
      code: 0,
    };

    for (const file of files) {
      let matched = false;
      for (const { type, pattern } of filePatterns) {
        if (pattern.test(file)) {
          typeCounts[type]++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        typeCounts.code++;
      }
    }

    // Determine commit type based on what changed
    const total = files.length;
    if (typeCounts.test > 0 && typeCounts.test === total) {
      commitType = 'test';
      subject = 'update tests';
    } else if (typeCounts.docs > 0 && typeCounts.docs === total) {
      commitType = 'docs';
      subject = 'update documentation';
    } else if (typeCounts.ci > 0 && typeCounts.ci === total) {
      commitType = 'ci';
      subject = 'update CI configuration';
    } else if (typeCounts.style > 0 && typeCounts.style === total) {
      commitType = 'style';
      subject = 'update styles';
    } else if (typeCounts.config > 0 && typeCounts.config === total) {
      commitType = 'chore';
      subject = 'update configuration';
    } else {
      // Mixed or code changes - try to infer from file names/paths
      scope = this.majorityScope(files);
      const mainFile = files[0];
      const fileName = mainFile.split('/').pop() || mainFile;
      const baseName = fileName.replace(/\.[^.]*$/, '');

      // Check diff for hints about the type of change
      if (diff) {
        const insertionMatch = diff.match(/(\d+)\s+insertions?\(\+\)/);
        const deletionMatch = diff.match(/(\d+)\s+deletions?\(-\)/);
        const insertions = insertionMatch ? parseInt(insertionMatch[1], 10) : 0;
        const deletions = deletionMatch ? parseInt(deletionMatch[1], 10) : 0;

        // Large deletions with few insertions might be refactoring
        if (deletions > insertions * 2 && deletions > 50) {
          commitType = 'refactor';
          subject = scope ? `refactor ${scope}` : `refactor ${baseName}`;
        } else if (insertions > deletions * 3 && insertions > 50) {
          // Mostly additions - likely a new feature
          commitType = 'feat';
          subject = scope ? `add ${scope} functionality` : `add ${baseName}`;
        } else {
          // Balanced changes - could be a fix or update
          commitType = 'chore';
          subject = scope ? `update ${scope}` : `update ${baseName}`;
        }
      } else {
        subject = scope ? `update ${scope}` : `update ${baseName}`;
      }
    }

    // Format the message
    const scopePart = scope && !subject.includes(scope) ? `(${scope})` : '';
    const message = `${commitType}${scopePart}: ${subject}`;

    // Ensure message isn't too long
    if (message.length > 72) {
      return { message: message.substring(0, 69) + '...' };
    }

    return { message };
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
        await execAsync('git remote get-url origin', { cwd: taskPath });
        // Remote exists, try to fetch
        try {
          await execAsync('git fetch origin --quiet', { cwd: taskPath });
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
        await execAsync(`git rev-parse --verify origin/${baseBranch}`, { cwd: taskPath });
        baseBranchExists = true;
        baseBranchRef = `origin/${baseBranch}`;
      } catch {
        // Fall back to local branch only if remote doesn't exist
        try {
          await execAsync(`git rev-parse --verify ${baseBranch}`, { cwd: taskPath });
          baseBranchExists = true;
          baseBranchRef = baseBranch;
        } catch {
          // Base branch doesn't exist, will use working directory diff
        }
      }

      if (baseBranchExists) {
        // Get diff between base branch and current HEAD (committed changes)
        try {
          const { stdout: diffOut } = await execAsync(`git diff ${baseBranchRef}...HEAD --stat`, {
            cwd: taskPath,
            maxBuffer: 10 * 1024 * 1024,
          });
          diff = diffOut || '';

          // Get list of changed files from commits
          const { stdout: filesOut } = await execAsync(
            `git diff --name-only ${baseBranchRef}...HEAD`,
            { cwd: taskPath }
          );
          const committedFiles = (filesOut || '')
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);
          changedFiles.push(...committedFiles);

          // Get commit messages
          const { stdout: commitsOut } = await execAsync(
            `git log ${baseBranchRef}..HEAD --pretty=format:"%s"`,
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
        const { stdout: workingDiff } = await execAsync('git diff --stat', {
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
        const { stdout: filesOut } = await execAsync('git diff --name-only', {
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
          const { stdout: stagedDiff } = await execAsync('git diff --cached --stat', {
            cwd: taskPath,
            maxBuffer: 10 * 1024 * 1024,
          });
          if (stagedDiff) {
            diff = stagedDiff;
            const { stdout: filesOut } = await execAsync('git diff --cached --name-only', {
              cwd: taskPath,
            });
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

    // Use spawn with stdin/stdout to invoke the CLI agent non-interactively
    // This uses the user's authenticated CLI agent (no API keys needed)
    return new Promise<GeneratedPrContent | null>((resolve) => {
      const timeout = 30000; // 30 second timeout
      let stdout = '';
      let stderr = '';

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
        cwd: taskPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure we have a proper terminal environment
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
  "description": "A well-structured markdown description using proper markdown formatting. Use ## for section headers, - or * for lists, \`code\` for inline code, and proper line breaks.\n\nUse actual newlines (\\n in JSON) for line breaks, not literal \\n text. Keep it straightforward and to the point."
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
          let description = String(parsed.description);

          // Handle multiple newline escape scenarios:
          // 1. Literal backslash-n sequences (from double-escaped JSON like "\\n")
          // 2. String representations of newlines
          // Do this before trimming to preserve intentional whitespace

          // First, check if we have literal \n characters (backslash followed by n)
          // This happens when JSON contains "\\n" which becomes "\n" after parsing
          if (description.includes('\\n')) {
            // Replace literal backslash-n with actual newlines
            description = description.replace(/\\n/g, '\n');
          }

          // Also handle case where newlines might be represented as literal text "\\n" (double backslash)
          // This is less common but could happen if the LLM outputs raw text
          description = description.replace(/\\\\n/g, '\n');

          // Trim after processing newlines
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
