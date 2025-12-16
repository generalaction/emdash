import { spawn } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';
import { getProvider, type ProviderId } from '../../shared/providers/registry';
import type { RunConfigFile, ResolvedRunConfig, PackageManager } from '../../shared/worktreeRun/config';
import { resolveRunConfig, createDefaultRunConfig } from '../../shared/worktreeRun/config';

const execFileAsync = promisify(execFile);

export interface GeneratedRunConfig {
  config: RunConfigFile;
  reasoning?: string;
}

/**
 * Generates run configuration using CLI coding agents (Claude Code, Codex, etc.)
 * Follows the same pattern as PrGenerationService
 */
export class RunConfigGenerationService {
  /**
   * Generate run config by analyzing project structure
   * @param projectPath - Path to the project
   * @param preferredProviderId - Optional provider ID (e.g., from workspace settings)
   */
  async generateRunConfig(
    projectPath: string,
    preferredProviderId?: string | null
  ): Promise<GeneratedRunConfig | null> {
    try {
      // Analyze project structure
      const projectContext = await this.analyzeProjectStructure(projectPath);

      // Try preferred provider first
      if (preferredProviderId) {
        const result = await this.generateWithProvider(
          preferredProviderId as ProviderId,
          projectPath,
          projectContext
        );
        if (result) {
          log.info(`Generated run config with preferred provider: ${preferredProviderId}`);
          return result;
        }
      }

      // Fallback: Try Claude Code
      try {
        const claudeResult = await this.generateWithProvider(
          'claude',
          projectPath,
          projectContext
        );
        if (claudeResult) {
          log.info('Generated run config with Claude Code');
          return claudeResult;
        }
      } catch (error) {
        log.debug('Claude Code generation failed, trying Codex', { error });
      }

      // Fallback: Try Codex
      try {
        const codexResult = await this.generateWithProvider('codex', projectPath, projectContext);
        if (codexResult) {
          log.info('Generated run config with Codex');
          return codexResult;
        }
      } catch (error) {
        log.debug('Codex generation failed, will use heuristic', { error });
      }

      // No AI available - return null (caller will use heuristic fallback)
      return null;
    } catch (error) {
      log.error('Failed to generate run config', { error });
      return null;
    }
  }

  /**
   * Analyze project to provide context for AI generation
   */
  private async analyzeProjectStructure(projectPath: string): Promise<{
    packageJson: any | null;
    hasDockerfile: boolean;
    hasDockerCompose: boolean;
    packageManager: PackageManager;
    detectedFrameworks: string[];
  }> {
    // Read package.json
    let packageJson: any | null = null;
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      } catch {
        // Fail silently
      }
    }

    // Detect package manager
    const packageManager = this.detectPackageManager(projectPath);

    // Detect frameworks
    const detectedFrameworks = this.detectFrameworks(packageJson);

    // Check for Docker
    const hasDockerfile = fs.existsSync(path.join(projectPath, 'Dockerfile'));
    const hasDockerCompose =
      fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
      fs.existsSync(path.join(projectPath, 'docker-compose.yaml'));

    return {
      packageJson,
      hasDockerfile,
      hasDockerCompose,
      packageManager,
      detectedFrameworks,
    };
  }

  /**
   * Generate config using a specific CLI provider
   * Pattern: PrGenerationService lines 184-335
   */
  private async generateWithProvider(
    providerId: ProviderId,
    projectPath: string,
    context: any
  ): Promise<GeneratedRunConfig | null> {
    const provider = getProvider(providerId);
    if (!provider || !provider.cli) return null;

    // Check if CLI is available
    try {
      await execFileAsync(provider.cli, provider.versionArgs || ['--version'], {
        cwd: projectPath,
      });
    } catch {
      log.debug(`Provider ${providerId} CLI not available`);
      return null;
    }

    // Build prompt
    const prompt = this.buildGenerationPrompt(context);

    // Spawn CLI with stdin/stdout (same pattern as PrGenerationService)
    return new Promise<GeneratedRunConfig | null>((resolve) => {
      const timeout = 45000; // 45s timeout (longer than PR generation)
      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout;

      const args: string[] = [];
      if (provider.defaultArgs?.length) args.push(...provider.defaultArgs);
      if (provider.autoApproveFlag) args.push(provider.autoApproveFlag);

      let promptViaStdin = true;
      if (provider.initialPromptFlag !== undefined && provider.initialPromptFlag !== '') {
        args.push(provider.initialPromptFlag);
        args.push(prompt);
        promptViaStdin = false;
      }

      const child = spawn(provider.cli, args, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      timeoutId = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        log.debug(`Provider ${providerId} generation timed out`);
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

      child.on('exit', (code: number | null) => {
        clearTimeout(timeoutId);

        if (code !== 0 && code !== null) {
          log.debug(`Provider ${providerId} exited with code ${code}`, { stderr });
          resolve(null);
          return;
        }

        const result = this.parseProviderResponse(stdout);
        if (result) {
          log.info(`Successfully generated run config with ${providerId}`);
          resolve(result);
        } else {
          log.debug(`Failed to parse response from ${providerId}`, { stdout, stderr });
          resolve(null);
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        log.debug(`Failed to spawn ${providerId}`, { error });
        resolve(null);
      });

      if (promptViaStdin && child.stdin) {
        try {
          child.stdin.write(prompt);
          child.stdin.write('\n');
          child.stdin.end();
        } catch (error) {
          clearTimeout(timeoutId);
          try {
            child.kill();
          } catch {}
          resolve(null);
        }
      } else if (child.stdin) {
        child.stdin.end();
      }
    });
  }

  /**
   * Build prompt for AI generation
   */
  private buildGenerationPrompt(context: any): string {
    const { packageJson, packageManager, detectedFrameworks, hasDockerfile } = context;

    const scripts = packageJson?.scripts || {};
    const dependencies = {
      ...packageJson?.dependencies,
      ...packageJson?.devDependencies,
    };

    const scriptsStr = Object.keys(scripts).length > 0 ? Object.keys(scripts).join(', ') : 'none';
    const depsStr =
      Object.keys(dependencies).length > 0
        ? Object.keys(dependencies).slice(0, 10).join(', ') + '...'
        : 'none';

    return `Analyze this project and generate a run configuration for development.

Project Analysis:
- Package Manager: ${packageManager}
- Detected Frameworks: ${detectedFrameworks.join(', ') || 'None'}
- Has Dockerfile: ${hasDockerfile}
- Available Scripts: ${scriptsStr}
- Dependencies: ${depsStr}

Please generate a .emdash/config.json file with the following structure:

{
  "version": 1,
  "packageManager": "${packageManager}",
  "install": "${packageManager} install",
  "scripts": [
    {
      "name": "dev",
      "command": "${packageManager} run dev",
      "port": 3000,
      "cwd": ".",
      "preview": true
    }
  ],
  "env": {},
  "setupSteps": []
}

Requirements:
1. Detect the main dev script(s) from package.json scripts
2. If multiple services (e.g., frontend + backend), create separate script entries
3. Infer ports from framework conventions (Next.js: 3000, Vite: 5173, Angular: 4200, etc.)
4. Set "preview": true for the main user-facing app
5. Include any necessary setup steps (e.g., "npx prisma generate", "npm run build:deps")

Respond ONLY with valid JSON matching the schema above. No other text.`;
  }

  /**
   * Parse AI response into run config
   */
  private parseProviderResponse(response: string): GeneratedRunConfig | null {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.version && parsed.scripts) {
          return {
            config: parsed,
            reasoning: undefined, // Could extract from AI response if provided
          };
        }
      }
    } catch (error) {
      log.debug('Failed to parse provider response', { error, response });
    }
    return null;
  }

  /**
   * Detect package manager from lockfiles
   */
  private detectPackageManager(projectPath: string): PackageManager {
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
    return 'npm';
  }

  /**
   * Detect frameworks from package.json
   */
  private detectFrameworks(packageJson: any): string[] {
    if (!packageJson) return [];

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const frameworks: string[] = [];
    if (deps['next']) frameworks.push('Next.js');
    if (deps['vite']) frameworks.push('Vite');
    if (deps['@angular/core']) frameworks.push('Angular');
    if (deps['react']) frameworks.push('React');
    if (deps['vue']) frameworks.push('Vue');
    if (deps['svelte']) frameworks.push('Svelte');
    if (deps['express']) frameworks.push('Express');
    if (deps['@nestjs/core']) frameworks.push('NestJS');
    if (deps['fastify']) frameworks.push('Fastify');

    return frameworks;
  }

  /**
   * Generate heuristic config when no AI available
   */
  async generateHeuristicConfig(projectPath: string): Promise<ResolvedRunConfig> {
    const context = await this.analyzeProjectStructure(projectPath);
    const { packageJson, packageManager } = context;

    const scripts = packageJson?.scripts || {};

    // Try to find dev script
    const devScriptName = ['dev', 'start', 'serve'].find((s) => scripts[s]);
    const command = devScriptName
      ? `${packageManager} run ${devScriptName}`
      : `${packageManager} run dev`;

    return {
      version: 1,
      packageManager,
      install: `${packageManager} install`,
      scripts: [
        {
          name: 'dev',
          command,
          port: null, // Let HostPreviewService auto-discover
          cwd: '.',
          preview: true,
        },
      ],
      env: {},
      setupSteps: [],
    };
  }
}

export const runConfigGenerationService = new RunConfigGenerationService();
