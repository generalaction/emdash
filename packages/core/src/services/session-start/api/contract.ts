import { defineContract, fallible } from '@emdash/wire/rpc';
import {
  acpSessionLaunchInputSchema,
  acpSessionLaunchResultSchema,
  sessionStartErrorSchema,
  tuiSessionStartInputSchema,
  tuiSessionStartResultSchema,
} from './schemas';

export const acpSessionLaunchContract = defineContract({
  launch: fallible({
    input: acpSessionLaunchInputSchema,
    data: acpSessionLaunchResultSchema,
    error: sessionStartErrorSchema,
  }),
});

export const tuiSessionStartContract = defineContract({
  start: fallible({
    input: tuiSessionStartInputSchema,
    data: tuiSessionStartResultSchema,
    error: sessionStartErrorSchema,
  }),
});

export type AcpSessionLaunchContract = typeof acpSessionLaunchContract;
export type TuiSessionStartContract = typeof tuiSessionStartContract;
