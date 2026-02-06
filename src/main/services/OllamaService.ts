import { log } from '../lib/logger';
import { getAppSettings } from '../settings';

export interface TaskNameContext {
  initialPrompt: string | null;
  userMessages: string[];
  currentName: string;
}

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const TIMEOUT_MS = 10_000;
const VALID_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 60;

class OllamaService {
  async generateTaskName(context: TaskNameContext): Promise<string | null> {
    try {
      const settings = getAppSettings();
      const model = settings.tasks?.llmRenameModel || 'llama3.2:1b';

      const contextParts: string[] = [];
      if (context.initialPrompt) {
        contextParts.push(`Initial prompt: ${context.initialPrompt}`);
      }
      if (context.userMessages.length > 0) {
        contextParts.push(`User messages:\n${context.userMessages.join('\n')}`);
      }
      if (contextParts.length === 0) {
        log.debug('[OllamaService] No context available, skipping rename');
        return null;
      }

      const prompt = `You are a task naming assistant. Given the following context about a coding task, generate a short descriptive name in kebab-case (lowercase words separated by hyphens). The name should be 2-5 words that describe what the task is doing. Only output the name, nothing else.

Context:
${contextParts.join('\n\n')}

Current auto-generated name: ${context.currentName}

Output only the kebab-case name:`;

      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        log.debug(`[OllamaService] HTTP ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = (await response.json()) as { response?: string };
      const raw = (data.response ?? '').trim().toLowerCase();

      // Take only the first line in case the model is chatty
      const name = raw.split('\n')[0].trim();

      if (!name || name.length > MAX_NAME_LENGTH || !VALID_NAME.test(name)) {
        log.debug(`[OllamaService] Invalid name generated: "${name}"`);
        return null;
      }

      log.debug(`[OllamaService] Generated name: "${name}"`);
      return name;
    } catch (err) {
      log.debug('[OllamaService] Failed to generate task name:', err);
      return null;
    }
  }
}

export const ollamaService = new OllamaService();
