// packages/cli-agent-plugins/helpers/hooks.ts

export type HookCommandOptions = {
    platform: NodeJS.Platform;
    eventType: string;
  };
  
  export function buildEmdashHookCommand(opts: HookCommandOptions): string {
    // if (opts.platform === 'win32') {
    //   return buildPowershellHookCommand(opts);
    // }
    return (
      'curl -sf -X POST ' +
      '-H "Content-Type: application/json" ' +
      '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
      '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
      `-H "X-Emdash-Event-Type: ${opts.eventType}" ` +
      '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
    );
  }
  
  export const EMDASH_MARKER = 'EMDASH_HOOK_PORT';
  
  /** Filter out emdash-managed entries from a hook array */
  export function filterUserHooks<T>(entries: T[], stringify?: (entry: T) => string): T[] {
    const toStr = stringify ?? JSON.stringify;
    return entries.filter((entry) => !toStr(entry).includes(EMDASH_MARKER));
  }
  
  /** Standard hook events emdash registers for most agents */
  export function standardHookEvents(ctx: { platform: NodeJS.Platform }) {
    return {
      notification: buildEmdashHookCommand({ platform: ctx.platform, eventType: 'notification' }),
      stop: buildEmdashHookCommand({ platform: ctx.platform, eventType: 'stop' }),
      session: buildEmdashHookCommand({ platform: ctx.platform, eventType: 'session' }),
      start: buildEmdashHookCommand({ platform: ctx.platform, eventType: 'start' }),
    };
  }