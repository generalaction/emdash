import { chordsEqual, tokenKind, translateCodeChord, type Chord } from './chord';
import type { PlatformContext } from './chord';
import { resolveEffectiveChord, type ChordOverrides, type Keybinding } from './define-keybinding';
import { CODE_TO_US_CHAR, type CodeToCharMap } from './key-codes';

export interface KeybindingEntry {
  readonly id: string;
  readonly group?: string;
  readonly binding: Keybinding;
}

export interface ConflictInfo {
  readonly severity: 'reserved' | 'error' | 'shadowing';
  readonly id: string;
}

function chordsCollide(left: Chord, right: Chord, codeToCharMap: CodeToCharMap): boolean {
  const leftKind = tokenKind(left);
  const rightKind = tokenKind(right);
  if (leftKind === rightKind) return chordsEqual(left, right);
  if (leftKind === 'named' || rightKind === 'named') return false;

  const codeChord = leftKind === 'code' ? left : right;
  const charChord = leftKind === 'char' ? left : right;
  const translated = translateCodeChord(codeChord, codeToCharMap);
  return translated !== null && chordsEqual(translated, charChord);
}

export function findConflicts(
  entries: readonly KeybindingEntry[],
  candidate: Chord,
  forId: string,
  overrides: ChordOverrides,
  context: PlatformContext,
  codeToCharMap: CodeToCharMap = CODE_TO_US_CHAR
): ConflictInfo[] {
  const target = entries.find((entry) => entry.id === forId);
  if (!target) {
    throw new Error(`Unknown keybinding entry: ${forId}`);
  }

  const conflicts: ConflictInfo[] = [];
  for (const entry of entries) {
    if (entry.id === forId) continue;

    const effective = resolveEffectiveChord(entry.binding, overrides, context);
    if (!effective || !chordsCollide(candidate, effective, codeToCharMap)) continue;

    conflicts.push({
      severity:
        entry.binding.kind === 'fixed'
          ? 'reserved'
          : entry.group === target.group
            ? 'error'
            : 'shadowing',
      id: entry.id,
    });
  }
  return conflicts;
}
