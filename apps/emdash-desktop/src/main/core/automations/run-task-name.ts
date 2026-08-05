import { generateRandom } from '@main/core/tasks/name-generation/generateTaskName';
import type { Automation } from '@shared/core/automations/automation';
import { normalizeTaskName } from '@shared/core/tasks/task-names';

const MAX_BASE_LENGTH = 58;

export function runTaskNameBase(automation: Automation): string {
  const base = normalizeTaskName(automation.name).slice(0, MAX_BASE_LENGTH).replace(/-+$/, '');
  return base || generateRandom();
}
