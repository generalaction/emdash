/**
 * Pure derivation of SessionConfigState groups from a raw ACP SessionConfigOption array.
 *
 * The ACP SDK passes config options as a flat array, each tagged with a `category`
 * string and a `type`. This module maps the known categories to first-class typed
 * groups in SessionConfigState. Unknown categories are silently ignored — they remain
 * extension points.
 *
 * Stateless and side-effect-free; safe to call on every config_option_update.
 */

import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import type {
  EffortOption,
  FastModeOption,
  ModeOption,
  ModelChoice,
  SessionConfigState,
} from '../models/config';

/** Shape of a single ACP option entry within a select-type config option. */
type RawOption = { value: string; name: string; description?: string | null };

function toEffortOption(raw: RawOption): EffortOption {
  const opt: EffortOption = { id: raw.value, name: raw.name };
  if (raw.description) opt.description = raw.description;
  return opt;
}

function toModeOption(raw: RawOption): ModeOption {
  const opt: ModeOption = { id: raw.value, name: raw.name };
  if (raw.description) opt.description = raw.description;
  return opt;
}

function toFastModeOption(raw: RawOption): FastModeOption {
  const opt: FastModeOption = { id: raw.value, name: raw.name };
  if (raw.description) opt.description = raw.description;
  return opt;
}

function toModelChoice(raw: RawOption): ModelChoice {
  const opt: ModelChoice = { id: raw.value, name: raw.name };
  if (raw.description) opt.description = raw.description;
  // features left undefined — not present in the current stream
  return opt;
}

function selectOptions(opt: SessionConfigOption): RawOption[] {
  if (opt.type !== 'select') return [];
  const raw = opt as unknown as { options?: RawOption[] };
  return Array.isArray(raw.options) ? raw.options : [];
}

/**
 * Map a raw `SessionConfigOption[]` to the typed groups of SessionConfigState.
 *
 * Category mapping:
 *   'model'         → modelOptions   (model selector)
 *   'thought_level' → efforts        (Claude effort / Codex reasoning effort)
 *   'fast-mode'     → fastMode       (Codex fast-mode toggle)
 *   'model_config'  → fastMode       (Claude fast-mode toggle)
 *   'mode'          → modeOptions    (permission mode)
 *
 * `configId` preserves the provider-owned ACP config option id, `selected` is taken from
 * `currentValue`, and `available` is the full options list.
 * Returns partial — only groups present in `options` are set; others are omitted.
 * The runtime merges this partial into the existing SessionConfigState.
 */
export function deriveConfigGroups(
  options: ReadonlyArray<SessionConfigOption>
): Partial<Pick<SessionConfigState, 'modelOptions' | 'efforts' | 'fastMode' | 'modeOptions'>> {
  const groups: Partial<
    Pick<SessionConfigState, 'modelOptions' | 'efforts' | 'fastMode' | 'modeOptions'>
  > = {};

  for (const opt of options) {
    if (opt.type !== 'select') continue;
    const rawSelected = (opt as unknown as { currentValue?: string }).currentValue ?? null;
    const rawOptions = selectOptions(opt);

    switch (opt.category) {
      case 'model':
        groups.modelOptions = {
          configId: opt.id,
          selected: rawSelected,
          available: rawOptions.map(toModelChoice),
        };
        break;
      case 'thought_level':
        groups.efforts = {
          configId: opt.id,
          selected: rawSelected,
          available: rawOptions.map(toEffortOption),
        };
        break;
      case 'fast-mode':
      case 'model_config':
        groups.fastMode = {
          configId: opt.id,
          selected: rawSelected,
          available: rawOptions.map(toFastModeOption),
        };
        break;
      case 'mode':
        groups.modeOptions = {
          configId: opt.id,
          selected: rawSelected,
          available: rawOptions.map(toModeOption),
        };
        break;
      // Unknown categories are ignored — extension point.
    }
  }

  return groups;
}
