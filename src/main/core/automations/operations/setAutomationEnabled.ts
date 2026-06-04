import { automationEvents } from '../automation-events';
import { setAutomationEnabled as setInService } from '../service';

export async function setAutomationEnabled(id: string, enabled: boolean) {
  const automation = await setInService(id, enabled);
  if (!automation) throw new Error('automation_not_found');
  automationEvents._emit('automation:changed');
  return automation;
}
