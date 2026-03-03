import { request } from 'https';
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
  amp: 'AMP_API_KEY',
};

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  claude: 'claude-haiku-4-5-20251001',
  codex: 'gpt-4o-mini',
  cursor: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash-lite',
  qwen: 'qwen-turbo',
  mistral: 'mistral-small-latest',
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

function isAnthropicProvider(providerId: string): boolean {
  return providerId === 'claude';
}

function isOpenAICompatible(providerId: string): boolean {
  return ['codex', 'cursor', 'mistral'].includes(providerId);
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
            const text = parsed.content?.[0]?.text ?? '';
            resolve(text);
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
            const text = parsed.choices?.[0]?.message?.content ?? '';
            resolve(text);
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

export async function generateSummary(
  terminalContent: string,
  providerId: string
): Promise<string> {
  const settings = getAppSettings();
  const summarySettings = settings.summary;

  const effectiveProvider = summarySettings?.provider ?? providerId;
  const model = summarySettings?.model ?? getDefaultModelForProvider(effectiveProvider);
  const apiKey = getApiKeyForProvider(effectiveProvider);

  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${effectiveProvider}". Set the ${PROVIDER_API_KEY_MAP[effectiveProvider] ?? 'API key'} environment variable.`
    );
  }

  log.info(`Generating summary with provider=${effectiveProvider}, model=${model}`);

  if (isAnthropicProvider(effectiveProvider)) {
    return callAnthropic(apiKey, model, terminalContent);
  }

  if (isOpenAICompatible(effectiveProvider)) {
    const baseUrl = process.env.OPENAI_BASE_URL;
    return callOpenAICompatible(apiKey, model, terminalContent, baseUrl);
  }

  // Fallback: try Anthropic if we have the key
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return callAnthropic(anthropicKey, 'claude-haiku-4-5-20251001', terminalContent);
  }

  throw new Error(`Unsupported provider "${effectiveProvider}" for summary generation.`);
}
