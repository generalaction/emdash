import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { parse } from 'smol-toml';

/** 只信任用户级 Codex 配置的声明；项目配置不能扩大继承环境的范围。 */
export async function readCodexAuthEnvKeys(fs: Pick<PluginFs, 'read'>): Promise<readonly string[]> {
  const content = await fs.read('config.toml');
  if (content === null) return [];
  let config: Record<string, unknown>;
  try {
    config = parse(content);
  } catch {
    // TOML 解析错误可能包含原文和密钥，不能直接传播给日志或界面。
    throw new Error('Cannot parse Codex user config.toml for authentication environment');
  }
  if (!isRecord(config.model_providers)) return [];
  const keys = new Set<string>();
  for (const provider of Object.values(config.model_providers)) {
    if (!isRecord(provider)) continue;
    addEnvKey(keys, provider.env_key);
    if (isRecord(provider.env_http_headers)) {
      for (const key of Object.values(provider.env_http_headers)) addEnvKey(keys, key);
    }
  }
  return [...keys];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addEnvKey(keys: Set<string>, value: unknown): void {
  if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) keys.add(value);
}
