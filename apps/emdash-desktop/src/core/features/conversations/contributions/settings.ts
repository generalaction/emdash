import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

export const preferredConversationTypeSettingsContribution = defineSettingsContribution({
  key: 'preferredConversationType',
  schema: z.enum(['acp', 'pty']),
  defaults: 'pty' as const,
});
