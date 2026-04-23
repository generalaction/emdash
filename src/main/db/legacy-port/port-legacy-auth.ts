import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

type LegacySecretSpec = {
  label: string;
  legacyService: string;
  legacyAccount: string;
  appSecretKey: string;
};

type KvWrite = {
  namespace: string;
  key: string;
  value: unknown;
  label: string;
};

type SecretWrite = {
  key: string;
  encryptedSecret: string;
  label: string;
};

type LegacyAccountProfile = {
  hasAccount: boolean;
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
  lastValidated: string;
};

export type LegacySecretReader = (service: string, account: string) => Promise<string | null>;
export type LegacySecretEncryptor = (secret: string) => string | null | Promise<string | null>;

export type PortLegacyAuthStateOptions = {
  appDb: Database.Database;
  readLegacySecret?: LegacySecretReader;
  encryptSecret?: LegacySecretEncryptor;
};

export type LegacyAuthPortSummary = {
  importedSecrets: string[];
  importedKv: string[];
  skipped: string[];
};

const LEGACY_SECRET_SPECS: LegacySecretSpec[] = [
  {
    label: 'github',
    legacyService: 'emdash-github',
    legacyAccount: 'github-token',
    appSecretKey: 'emdash-github-token',
  },
  {
    label: 'linear',
    legacyService: 'emdash-linear',
    legacyAccount: 'api-token',
    appSecretKey: 'emdash-linear-token',
  },
  {
    label: 'jira',
    legacyService: 'emdash-jira',
    legacyAccount: 'api-token',
    appSecretKey: 'emdash-jira-token',
  },
  {
    label: 'plain',
    legacyService: 'emdash-plain',
    legacyAccount: 'api-token',
    appSecretKey: 'emdash-plain-token',
  },
  {
    label: 'forgejo',
    legacyService: 'emdash-forgejo',
    legacyAccount: 'forgejo-token',
    appSecretKey: 'emdash-forgejo-token',
  },
  {
    label: 'gitlab',
    legacyService: 'emdash-gitlab',
    legacyAccount: 'gitlab-token',
    appSecretKey: 'emdash-gitlab-token',
  },
  {
    label: 'account',
    legacyService: 'emdash-account',
    legacyAccount: 'session-token',
    appSecretKey: 'emdash-account-token',
  },
];

function hasTable(appDb: Database.Database, tableName: string): boolean {
  const row = appDb
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName) as { 1: number } | undefined;
  return !!row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type JsonReadResult = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'ok'; value: unknown };

function readJsonFile(filePath: string): JsonReadResult {
  try {
    if (!existsSync(filePath)) return { kind: 'missing' };
    return { kind: 'ok', value: JSON.parse(readFileSync(filePath, 'utf8')) as unknown };
  } catch {
    return { kind: 'invalid' };
  }
}

function normalizeHostedInstanceUrl(instanceUrl: string): string | null {
  const trimmed = instanceUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.search || parsed.hash) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    return pathname && pathname !== '/'
      ? `${parsed.protocol}//${parsed.host}${pathname}`
      : `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function parseJiraCreds(raw: unknown): { siteUrl: string; email: string } | null {
  if (!isRecord(raw)) return null;
  const siteUrl = readTrimmedString(raw.siteUrl);
  const email = readTrimmedString(raw.email);
  if (!siteUrl || !email) return null;
  return { siteUrl, email };
}

function parseHostedConnection(raw: unknown): { instanceUrl: string } | null {
  if (!isRecord(raw)) return null;

  const siteUrl =
    readTrimmedString(raw.instanceUrl) ??
    readTrimmedString(raw.siteUrl) ??
    readTrimmedString(raw.url);
  if (!siteUrl) return null;

  const instanceUrl = normalizeHostedInstanceUrl(siteUrl);
  if (!instanceUrl) return null;

  return { instanceUrl };
}

function parseLegacyAccountProfile(raw: unknown): LegacyAccountProfile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.hasAccount !== 'boolean') return null;

  const userId = readTrimmedString(raw.userId);
  const username = readTrimmedString(raw.username);
  const avatarUrl = readTrimmedString(raw.avatarUrl);
  const email = readTrimmedString(raw.email);
  const lastValidated = readTrimmedString(raw.lastValidated) ?? new Date().toISOString();

  if (!userId || !username || !avatarUrl || !email) return null;

  return {
    hasAccount: raw.hasAccount,
    userId,
    username,
    avatarUrl,
    email,
    lastValidated,
  };
}

async function defaultReadLegacySecret(service: string, account: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        service,
        '-a',
        account,
        '-w',
      ]);
      const secret = stdout.trim();
      return secret.length > 0 ? secret : null;
    } catch {
      return null;
    }
  }

  if (process.platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('secret-tool', [
        'lookup',
        'service',
        service,
        'account',
        account,
      ]);
      const secret = stdout.trim();
      return secret.length > 0 ? secret : null;
    } catch {
      return null;
    }
  }

  return null;
}

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean;
  encryptString: (secret: string) => Buffer;
  getSelectedStorageBackend?: () => string;
};

async function createDefaultEncryptor(): Promise<LegacySecretEncryptor | null> {
  if (!process.versions.electron) {
    return null;
  }

  try {
    const electron = (await import('electron')) as { safeStorage?: SafeStorageLike };
    const safeStorage = electron.safeStorage;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      return null;
    }

    if (
      process.platform === 'linux' &&
      typeof safeStorage.getSelectedStorageBackend === 'function' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      return null;
    }

    return (secret: string) => safeStorage.encryptString(secret).toString('base64');
  } catch {
    return null;
  }
}

function addKvWrite(
  kvWrites: KvWrite[],
  summary: LegacyAuthPortSummary,
  hasKvTable: boolean,
  write: KvWrite
): void {
  if (!hasKvTable) {
    summary.skipped.push(`${write.label}:kv-table-missing`);
    return;
  }
  kvWrites.push(write);
  summary.importedKv.push(write.label);
}

export async function portLegacyAuthState(
  userDataPath: string,
  options: PortLegacyAuthStateOptions
): Promise<LegacyAuthPortSummary> {
  const { appDb } = options;
  const summary: LegacyAuthPortSummary = {
    importedSecrets: [],
    importedKv: [],
    skipped: [],
  };

  const hasKvTable = hasTable(appDb, 'kv');
  const hasSecretsTable = hasTable(appDb, 'app_secrets');

  if (!hasKvTable && !hasSecretsTable) {
    summary.skipped.push('auth-port:missing-kv-and-app-secrets-tables');
    return summary;
  }

  const readLegacySecret = options.readLegacySecret ?? defaultReadLegacySecret;
  const encryptSecret = options.encryptSecret ?? (await createDefaultEncryptor());

  const secretWrites: SecretWrite[] = [];
  const kvWrites: KvWrite[] = [];

  if (hasSecretsTable && encryptSecret) {
    for (const spec of LEGACY_SECRET_SPECS) {
      const rawSecret = await readLegacySecret(spec.legacyService, spec.legacyAccount);
      const secret = readTrimmedString(rawSecret);

      if (!secret) {
        continue;
      }

      const encryptedSecret = await encryptSecret(secret);
      if (!encryptedSecret) {
        summary.skipped.push(`${spec.label}:secret-encryption-failed`);
        continue;
      }

      secretWrites.push({ key: spec.appSecretKey, encryptedSecret, label: spec.label });
      summary.importedSecrets.push(spec.label);
    }
  } else if (!hasSecretsTable) {
    summary.skipped.push('auth-port:app-secrets-table-missing');
  } else {
    summary.skipped.push('auth-port:secret-encryption-unavailable');
  }

  if (summary.importedSecrets.includes('github')) {
    addKvWrite(kvWrites, summary, hasKvTable, {
      namespace: 'github',
      key: 'tokenSource',
      value: 'secure_storage',
      label: 'github.tokenSource',
    });
  }

  const jiraResult = readJsonFile(join(userDataPath, 'jira.json'));
  if (jiraResult.kind === 'invalid') {
    summary.skipped.push('jira.creds:invalid-json');
  }
  const jiraCreds = jiraResult.kind === 'ok' ? parseJiraCreds(jiraResult.value) : null;
  if (jiraCreds) {
    addKvWrite(kvWrites, summary, hasKvTable, {
      namespace: 'jira',
      key: 'creds',
      value: jiraCreds,
      label: 'jira.creds',
    });
  }

  const forgejoResult = readJsonFile(join(userDataPath, 'forgejo.json'));
  if (forgejoResult.kind === 'invalid') {
    summary.skipped.push('forgejo.connection:invalid-json');
  }
  const forgejoConnection =
    forgejoResult.kind === 'ok' ? parseHostedConnection(forgejoResult.value) : null;
  if (forgejoConnection) {
    addKvWrite(kvWrites, summary, hasKvTable, {
      namespace: 'forgejo',
      key: 'connection',
      value: forgejoConnection,
      label: 'forgejo.connection',
    });
  }

  const gitlabResult = readJsonFile(join(userDataPath, 'gitlab.json'));
  if (gitlabResult.kind === 'invalid') {
    summary.skipped.push('gitlab.connection:invalid-json');
  }
  const gitlabConnection =
    gitlabResult.kind === 'ok' ? parseHostedConnection(gitlabResult.value) : null;
  if (gitlabConnection) {
    addKvWrite(kvWrites, summary, hasKvTable, {
      namespace: 'gitlab',
      key: 'connection',
      value: gitlabConnection,
      label: 'gitlab.connection',
    });
  }

  const accountResult = readJsonFile(join(userDataPath, 'emdash-account.json'));
  if (accountResult.kind === 'invalid') {
    summary.skipped.push('account.profile:invalid-json');
  }
  const accountProfile =
    accountResult.kind === 'ok' ? parseLegacyAccountProfile(accountResult.value) : null;
  if (accountProfile) {
    addKvWrite(kvWrites, summary, hasKvTable, {
      namespace: 'account',
      key: 'profile',
      value: accountProfile,
      label: 'account.profile',
    });
  }

  if (secretWrites.length === 0 && kvWrites.length === 0) {
    return summary;
  }

  const upsertSecretStatement = hasSecretsTable
    ? appDb.prepare(
        `INSERT INTO app_secrets (key, secret) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET secret = excluded.secret`
      )
    : null;

  const upsertKvStatement = hasKvTable
    ? appDb.prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
    : null;

  appDb.transaction(() => {
    for (const row of secretWrites) {
      upsertSecretStatement?.run(row.key, row.encryptedSecret);
    }

    const now = Date.now();
    for (const row of kvWrites) {
      upsertKvStatement?.run(`${row.namespace}:${row.key}`, JSON.stringify(row.value), now);
    }
  })();

  return summary;
}
