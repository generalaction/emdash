export interface EnvPasteEntry {
  key: string;
  value: string;
}

const ENV_ASSIGNMENT_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseEnvAssignmentPaste(text: string): EnvPasteEntry[] {
  const parsed: EnvPasteEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = ENV_ASSIGNMENT_RE.exec(line);
    if (!match) return [];

    parsed.push({
      key: match[1],
      value: normalizeEnvValue(match[2]),
    });
  }

  return parsed;
}

export function replaceEnvEntryWithPaste<T extends EnvPasteEntry>(
  entries: readonly T[],
  startIndex: number,
  pasted: readonly T[]
): T[] {
  if (pasted.length === 0) return [...entries];

  return [...entries.slice(0, startIndex), ...pasted, ...entries.slice(startIndex + 1)];
}

function normalizeEnvValue(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (
    trimmed.length >= 2 &&
    (quote === '"' || quote === "'" || quote === '`') &&
    trimmed[trimmed.length - 1] === quote
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
