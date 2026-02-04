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

/** Default provider fallback order */
const FALLBACK_PROVIDERS: ProviderId[] = ['claude', 'codex'];
/** Default provider CLI timeout */
const PROVIDER_CLI_TIMEOUT_MS = 30000;

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

      // Build prompt for PR generation
      const prompt = this.buildPrGenerationPrompt(diff, commits);

      // Try providers with fallback chain
      const result = await this.tryProvidersWithFallback<GeneratedPrContent>(
        preferredProviderId,
        taskPath,
        prompt,
        (stdout) => this.parseProviderResponse(stdout),
        'PR content'
      );

      if (result) {
        return {
          title: result.title,
          description: this.normalizeMarkdown(result.description),
        };
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

      // Build prompt for commit message generation
      const prompt = this.buildCommitMessagePrompt(stagedFiles, diff);

      // Try providers with fallback chain
      const result = await this.tryProvidersWithFallback<GeneratedCommitMessage>(
        preferredProviderId,
        taskPath,
        prompt,
        (stdout) => this.parseCommitMessageResponse(stdout),
        'commit message'
      );

      if (result) {
        return result;
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
   * Try multiple providers in sequence until one succeeds
   * @param preferredProviderId - Optional provider to try first
   * @param taskPath - Path to the task/repo
   * @param prompt - The prompt to send to the provider
   * @param parseResponse - Function to parse the provider's response
   * @param logContext - Context string for logging (e.g., "PR content", "commit message")
   */
  private async tryProvidersWithFallback<T>(
    preferredProviderId: string | null | undefined,
    taskPath: string,
    prompt: string,
    parseResponse: (stdout: string) => T | null,
    logContext: string
  ): Promise<T | null> {
    // Build provider list: preferred first, then fallbacks (avoiding duplicates)
    const providers: ProviderId[] = [];

    if (preferredProviderId && this.isValidProviderId(preferredProviderId)) {
      providers.push(preferredProviderId);
    }

    for (const fallback of FALLBACK_PROVIDERS) {
      if (!providers.includes(fallback)) {
        providers.push(fallback);
      }
    }

    // Try each provider in sequence
    for (const providerId of providers) {
      try {
        const result = await this.spawnProviderCli<T>(
          providerId,
          taskPath,
          prompt,
          parseResponse,
          logContext
        );
        if (result) {
          log.info(`Generated ${logContext} with ${providerId}`);
          return result;
        }
      } catch (error) {
        log.debug(`Provider ${providerId} ${logContext} generation failed`, { error });
      }
    }

    return null;
  }

  /**
   * Spawn a provider CLI and get a parsed response
   * @param providerId - The provider to use
   * @param taskPath - Path to the task/repo
   * @param prompt - The prompt to send
   * @param parseResponse - Function to parse the response
   * @param logContext - Context string for logging
   */
  private async spawnProviderCli<T>(
    providerId: ProviderId,
    taskPath: string,
    prompt: string,
    parseResponse: (stdout: string) => T | null,
    logContext: string
  ): Promise<T | null> {
    const provider = getProvider(providerId);
    if (!provider?.cli) {
      return null;
    }

    const cliCommand = provider.cli;

    // Check if provider CLI is available
    try {
      await execFileAsync(cliCommand, provider.versionArgs || ['--version'], {
        cwd: taskPath,
      });
    } catch {
      log.debug(`Provider ${providerId} CLI not available for ${logContext} generation`);
      return null;
    }

    return new Promise<T | null>((resolve) => {
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
        log.debug(`Provider ${providerId} ${logContext} generation timed out`);
        resolve(null);
      }, PROVIDER_CLI_TIMEOUT_MS);

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

        const result = parseResponse(stdout);
        if (result) {
          resolve(result);
        } else {
          log.debug(`Failed to parse ${logContext} from ${providerId}`, { stdout, stderr });
          resolve(null);
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        log.debug(`Failed to spawn ${providerId} for ${logContext}`, { error });
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
            child.kill('SIGTERM');
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
