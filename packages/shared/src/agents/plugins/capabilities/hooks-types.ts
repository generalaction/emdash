export const HOOK_EVENTS = [
  'notification',
  'stop',
  'session',
  'start',
  'tool-use',
  'tool-use-failure',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export type HookRegistration = {
  event: string;
  command: string;
};
