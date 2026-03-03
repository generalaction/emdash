import { request } from 'https';
import { spawn } from 'child_process';
import { log } from '../lib/logger';
import { getAppSettings } from '../settings';

const PROVIDER_API_KEY_MAP: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY',
  codex: 'OPENAI_API_KEY',
  cursor: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  kimi: 'KIMI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  claude: 'claude-haiku-4-5-20251001',
  codex: 'gpt-4o-mini',
  cursor: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash-lite',
  qwen: 'qwen-turbo',
  mistral: 'mistral-small-latest',
};

// CLI binaries that support -p flag for one-shot prompting
const PROVIDER_CLI_MAP: Record<string, string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  gemini: ['gemini'],
};

const SYSTEM_PROMPT =
  'Summarize the following terminal session output concisely. Focus on what was accomplished, key decisions, and current state. Keep the summary under 200 words.';

export function getApiKeyForProvider(providerId: string): string | undefined {
  const envVar = PROVIDER_API_KEY_MAP[providerId];
  if (!envVar) return undefined;
  return process.env[envVar];
}

export function getDefaultModelForProvider(providerId: string): string {
  return PROVIDER_DEFAULT_MODEL[providerId] ?? 'claude-haiku-4-5-20251001';
}

async function callAnthropic(apiKey: string, model: string, content: string): Promise<string> {
  const body = JSON.stringify({
    model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message ?? 'Anthropic API error'));
              return;
            }
            resolve(parsed.content?.[0]?.text ?? '');
          } catch {
            reject(new Error('Failed to parse Anthropic response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callOpenAICompatible(
  apiKey: string,
  model: string,
  content: string,
  baseUrl?: string
): Promise<string> {
  const url = new URL(baseUrl ?? 'https://api.openai.com');
  const body = JSON.stringify({
    model,
    max_tokens: 512,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message ?? 'API error'));
              return;
            }
            resolve(parsed.choices?.[0]?.message?.content ?? '');
          } catch {
            reject(new Error('Failed to parse API response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Call the agent CLI in print mode, piping the prompt via stdin.
 * Piping avoids OS argument-size limits when the terminal content is large.
 * The CLI uses its own stored credentials, so no API key env var is needed.
 */
async function callAgentCli(cli: string, content: string): Promise<string> {
  const prompt = `${SYSTEM_PROMPT}\n\nTerminal output:\n${content}`;

  return new Promise((resolve, reject) => {
    // 90s — CLI needs time to start up and stream the response
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Agent CLI timed out after 90s'));
    }, 90_000);

    // Use --print (= -p) without an argument so the CLI reads from stdin.
    // This avoids hitting OS arg-size limits for large terminal output.
    const child = spawn(cli, ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Agent CLI exited with code ${code}: ${stderr.slice(0, 300)}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Write prompt to stdin and close the stream so the CLI sees EOF
    child.stdin?.write(prompt, 'utf8');
    child.stdin?.end();
  });
}

export async function generateSummary(
  terminalContent: string,
  providerId: string
): Promise<string> {
  const settings = getAppSettings();
  const summarySettings = (settings as any).summary;

  const effectiveProvider = summarySettings?.provider ?? providerId;
  const model = summarySettings?.model ?? getDefaultModelForProvider(effectiveProvider);
  const apiKey = getApiKeyForProvider(effectiveProvider);

  // Direct API call if key is available
  if (apiKey) {
    log.info(`Generating summary via API: provider=${effectiveProvider}, model=${model}`);
    if (effectiveProvider === 'claude') {
      return callAnthropic(apiKey, model, terminalContent);
    }
    if (['codex', 'cursor', 'mistral'].includes(effectiveProvider)) {
      return callOpenAICompatible(apiKey, model, terminalContent, process.env.OPENAI_BASE_URL);
    }
  }

  // Fallback: try the agent CLI with -p flag
  const cliCandidates = PROVIDER_CLI_MAP[effectiveProvider] ?? PROVIDER_CLI_MAP['claude'];
  for (const cli of cliCandidates) {
    try {
      log.info(`No API key for "${effectiveProvider}", trying CLI fallback: ${cli} -p`);
      return await callAgentCli(cli, terminalContent);
    } catch (err) {
      log.warn(`CLI fallback failed for ${cli}:`, err);
    }
  }

  // Last resort: try claude CLI regardless of provider
  if (!cliCandidates.includes('claude')) {
    try {
      log.info('Trying claude CLI as last-resort fallback');
      return await callAgentCli('claude', terminalContent);
    } catch (err) {
      log.warn('claude CLI last-resort failed:', err);
    }
  }

  throw new Error(
    `No API key found for "${effectiveProvider}" and no CLI fallback available. ` +
      `Set the ${PROVIDER_API_KEY_MAP[effectiveProvider] ?? 'API key'} environment variable.`
  );
}
