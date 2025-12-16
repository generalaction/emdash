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
    isMonorepo: boolean;
    monorepoServices: Array<{ name: string; path: string; type: string }>;
  }> {
    // Read package.json at root
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

    // Detect monorepo structure (common subdirectories: frontend, backend, api, web, server, etc.)
    const monorepoServices = this.detectMonorepoServices(projectPath);
    const isMonorepo = monorepoServices.length > 0;

    return {
      packageJson,
      hasDockerfile,
      hasDockerCompose,
      packageManager,
      detectedFrameworks,
      isMonorepo,
      monorepoServices,
    };
  }

  /**
   * Detect monorepo services (frontend, backend, etc.)
   */
  private detectMonorepoServices(projectPath: string): Array<{ name: string; path: string; type: string }> {
    const services: Array<{ name: string; path: string; type: string }> = [];
    
    // Common monorepo directory names
    const commonDirs = ['frontend', 'backend', 'api', 'web', 'server', 'client', 'app', 'apps', 'packages'];
    
    try {
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const dirName = entry.name.toLowerCase();
        const dirPath = path.join(projectPath, entry.name);
        
        // Check if it's a common monorepo directory
        if (commonDirs.includes(dirName)) {
          // Detect type based on contents
          const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
          const hasPyprojectToml = fs.existsSync(path.join(dirPath, 'pyproject.toml'));
          const hasPoetryLock = fs.existsSync(path.join(dirPath, 'poetry.lock'));
          const hasRequirementsTxt = fs.existsSync(path.join(dirPath, 'requirements.txt'));
          
          let type = 'unknown';
          if (hasPackageJson) {
            type = 'node';
          } else if (hasPyprojectToml || hasPoetryLock || hasRequirementsTxt) {
            type = 'python';
          }
          
          if (type !== 'unknown') {
            services.push({
              name: entry.name,
              path: entry.name, // Relative path
              type,
            });
          }
        }
      }
    } catch (error) {
      log.debug('Failed to detect monorepo services', { error });
    }
    
    return services;
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

    const cliCommand = provider.cli;
    if (!cliCommand) return null;

    // Check if CLI is available
    try {
      await execFileAsync(cliCommand, provider.versionArgs || ['--version'], {
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

      // For non-interactive generation, we always pass prompt via stdin
      // Some providers have initialPromptFlag like '-i' which is for INTERACTIVE mode
      // and conflicts with stdin piping. For generation, we skip those flags.
      // Only use initialPromptFlag if it's an empty string (means: prompt is positional arg)
      let promptViaStdin = true;
      if (provider.initialPromptFlag !== undefined && provider.initialPromptFlag === '') {
        // Provider accepts prompt as a positional argument (e.g., claude, codex)
        args.push(prompt);
        promptViaStdin = false;
      }
      // Otherwise: pass prompt via stdin (works for most providers in non-interactive mode)

      const child = spawn(cliCommand, args, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      }) as import('child_process').ChildProcessWithoutNullStreams;

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
          log.debug(`Provider ${providerId} exited with code ${code}`, { 
            stderr: stderr.substring(0, 500) // Truncate for logs
          });
          resolve(null);
          return;
        }

        const result = this.parseProviderResponse(stdout);
        if (result) {
          log.info(`Successfully generated run config with ${providerId}`);
          resolve(result);
        } else {
          log.debug(`Failed to parse response from ${providerId}`, { 
            stdoutPreview: stdout.substring(0, 500),
            stderrPreview: stderr.substring(0, 200)
          });
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
    const { packageJson, packageManager, detectedFrameworks, hasDockerfile, isMonorepo, monorepoServices } = context;

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

    // Build monorepo info
    let monorepoInfo = '';
    if (isMonorepo && monorepoServices.length > 0) {
      monorepoInfo = `\n- Monorepo Structure: YES
- Services Detected:
${monorepoServices.map((s: any) => `  * ${s.name} (${s.type}) at ./${s.path}`).join('\n')}`;
    } else {
      monorepoInfo = '\n- Monorepo Structure: NO (single service)';
    }

    return `You are analyzing a software project to generate a development run configuration. Your goal is to create a .emdash/config.json file that will allow developers to run all services in this project.

## Project Context

**Package Manager:** ${packageManager}
**Detected Frameworks:** ${detectedFrameworks.join(', ') || 'None'}
**Has Dockerfile:** ${hasDockerfile}
**Root Scripts:** ${scriptsStr}
**Root Dependencies:** ${depsStr}${monorepoInfo}

## Your Task

Analyze the project structure and generate a COMPLETE, WORKING configuration. Follow these steps:

### Step 1: Identify Services

${isMonorepo && monorepoServices.length > 0 
  ? `This is a MONOREPO with ${monorepoServices.length} service(s):
${monorepoServices.map((s: any) => `- **${s.name}** (${s.type}) in \`./${s.path}/\``).join('\n')}

For EACH service:
1. If it's a Node service, read its package.json to find the dev script
2. If it's a Python service, determine the framework and entry point`
  : `This is a SINGLE SERVICE project (no monorepo structure detected).
- Look for package.json scripts or Python entry points at the root level`}

### Step 2: Generate Script Entries

For each service, create a script object with:
- **name**: descriptive name (e.g., "frontend", "backend", "api")
- **command**: the EXACT command to run the dev server
- **port**: the port number (or null if unknown - the system will auto-detect)
- **cwd**: relative path from project root (e.g., "./frontend" or "." for root)
- **preview**: true ONLY for the main user-facing app (usually frontend)

#### Node.js Service Commands:
- Read package.json scripts section
- Common patterns: \`npm run dev\`, \`npm run start\`, \`npm run serve\`
- Use the detected package manager: ${packageManager}

#### Python Service Commands:
Based on framework:
- **FastAPI**: \`poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000\`
- **Django**: \`poetry run python manage.py runserver 0.0.0.0:8000\`
- **Flask**: \`poetry run flask run --host 0.0.0.0 --port 5000\`

### Step 3: Setup Steps

Include ALL installation commands needed:
${isMonorepo && monorepoServices.length > 0
  ? `- For each Node service: \`cd <service-path> && ${packageManager} install\`
- For each Python service: \`cd <service-path> && poetry install\``
  : `- Single install command if root-level service`}

### Step 4: Generate JSON

Output ONLY valid JSON in this EXACT format:

{
  "version": 1,
  "packageManager": "${packageManager}",
  "install": "${packageManager} install",
  "scripts": [
    {
      "name": "service-name",
      "command": "full command to run dev server",
      "port": 3000,
      "cwd": "./path/to/service",
      "preview": true
    }
  ],
  "env": {},
  "setupSteps": ["cd path && install command"]
}

## Examples

**Example 1: Monorepo (Next.js + FastAPI)**
\`\`\`json
{
  "version": 1,
  "packageManager": "npm",
  "install": "npm install",
  "scripts": [
    {
      "name": "frontend",
      "command": "npm run dev",
      "port": 3000,
      "cwd": "./frontend",
      "preview": true
    },
    {
      "name": "backend",
      "command": "poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000",
      "port": 8000,
      "cwd": "./backend",
      "preview": false
    }
  ],
  "env": {},
  "setupSteps": [
    "cd frontend && npm install",
    "cd backend && poetry install"
  ]
}
\`\`\`

**Example 2: Single Service (Vite)**
\`\`\`json
{
  "version": 1,
  "packageManager": "npm",
  "install": "npm install",
  "scripts": [
    {
      "name": "dev",
      "command": "npm run dev",
      "port": 5173,
      "cwd": ".",
      "preview": true
    }
  ],
  "env": {},
  "setupSteps": []
}
\`\`\`

## CRITICAL RULES

1. **MUST be valid JSON** - no comments, no trailing commas, proper quotes
2. **MUST include all detected services** - don't skip any service
3. **MUST use correct cwd** - relative path from project root with "./" prefix
4. **MUST include setupSteps** - for monorepos, include install for each service
5. **MUST use poetry run** - for Python services using Poetry

## Output Format

Respond ONLY with valid JSON in this exact format (no markdown, no explanations, no other text):

{
  "version": 1,
  "packageManager": "npm",
  "install": "npm install",
  "scripts": [
    {
      "name": "service-name",
      "command": "command to run",
      "port": 3000,
      "cwd": "./relative-path",
      "preview": true
    }
  ],
  "setupSteps": ["step 1", "step 2"]
}

Only respond with valid JSON, no other text.`;
  }

  /**
   * Parse AI response into run config
   * Pattern: Same as PrGenerationService - handle markdown code blocks and embedded JSON
   */
  private parseProviderResponse(response: string): GeneratedRunConfig | null {
    try {
      // Strategy 1: Try to find JSON in markdown code blocks first (```json ... ```)
      const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (parsed.version && parsed.scripts) {
          return {
            config: parsed,
            reasoning: undefined,
          };
        }
      }

      // Strategy 2: Look for JSON objects containing our required keys
      // Extract all potential JSON objects and try parsing each
      const jsonObjectMatches = response.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
      
      for (const match of jsonObjectMatches) {
        try {
          const parsed = JSON.parse(match[0]);
          // Validate it's our config structure
          if (parsed.version && parsed.scripts && Array.isArray(parsed.scripts)) {
            return {
              config: parsed,
              reasoning: undefined,
            };
          }
        } catch {
          // Not valid JSON or not our structure, continue
        }
      }

      // Strategy 3: Fallback - extract largest JSON-like structure
      // This handles cases where JSON is embedded in text
      const allBraces = response.match(/\{[\s\S]*\}/);
      if (allBraces) {
        const jsonStr = allBraces[0];
        // Find the first complete JSON object by tracking brace depth
        let depth = 0;
        
        for (let i = 0; i < jsonStr.length; i++) {
          if (jsonStr[i] === '{') depth++;
          if (jsonStr[i] === '}') {
            depth--;
            if (depth === 0) {
              // Found a complete JSON object - try to parse it
              try {
                const candidate = jsonStr.substring(0, i + 1);
                const parsed = JSON.parse(candidate);
                if (parsed.version && parsed.scripts) {
                  return {
                    config: parsed,
                    reasoning: undefined,
                  };
                }
              } catch {
                // Not valid JSON, continue searching
              }
            }
          }
        }
      }
    } catch (error) {
      log.debug('Failed to parse provider response', { error, response: response.substring(0, 500) });
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

}

export const runConfigGenerationService = new RunConfigGenerationService();
