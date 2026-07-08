import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AMP_ACP_ADAPTER_SCRIPT } from './acp-adapter-script';

const AMP_ACP_ADAPTER_DIR = join(tmpdir(), 'emdash-amp-acp-adapter');
const AMP_ACP_ADAPTER_PATH = join(AMP_ACP_ADAPTER_DIR, 'adapter.cjs');

export function resolveAmpAcpAdapterEntry(): string {
  mkdirSync(AMP_ACP_ADAPTER_DIR, { recursive: true });
  writeFileSync(AMP_ACP_ADAPTER_PATH, AMP_ACP_ADAPTER_SCRIPT, 'utf8');
  return AMP_ACP_ADAPTER_PATH;
}
