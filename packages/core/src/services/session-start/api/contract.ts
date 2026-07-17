import { defineContract, fallible } from '@emdash/wire';
import {
  acpSessionStartInputSchema,
  acpSessionStartResultSchema,
  sessionStartErrorSchema,
  tuiSessionStartInputSchema,
  tuiSessionStartResultSchema,
} from './schemas';

export const acpSessionStartContract = defineContract({
  startSession: fallible({
    input: acpSessionStartInputSchema,
    data: acpSessionStartResultSchema,
    error: sessionStartErrorSchema,
  }),
});

export const tuiSessionStartContract = defineContract({
  startSession: fallible({
    input: tuiSessionStartInputSchema,
    data: tuiSessionStartResultSchema,
    error: sessionStartErrorSchema,
  }),
});

export type AcpSessionStartContract = typeof acpSessionStartContract;
export type TuiSessionStartContract = typeof tuiSessionStartContract;
