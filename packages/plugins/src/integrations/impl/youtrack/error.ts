import axios from 'axios';
import z from 'zod';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationError } from '../../types';

export function toYouTrackIntegrationError(error: unknown): IntegrationError {
  if (axios.isAxiosError(error) && !error.response) {
    return {
      type: 'host_unreachable',
      message: 'Unable to reach YouTrack. Check your instance URL and network connection.',
    };
  }
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return { type: 'generic', message: 'YouTrack returned an invalid API response.' };
  }
  const mapped = toIntegrationError(error, 'YouTrack');
  return mapped.type === 'generic'
    ? { type: 'generic', message: 'YouTrack request failed.' }
    : mapped;
}
