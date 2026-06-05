import { type ServerDb } from '../db/client.js';
import type { Automation, Config } from '../config.js';
import { type RunResult } from './docker.js';
type RunFn = (automation: Automation, oauthToken: string, uid: number, gid: number) => Promise<RunResult>;
export interface RunnerDeps {
    config: Config;
    /** Defaults to the shared DB; injectable for tests. */
    db?: ServerDb;
    /** Defaults to runAgentInDocker; injectable for tests. */
    run?: RunFn;
    /** Host uid/gid the container runs as. Defaults to the current process. */
    uid?: number;
    gid?: number;
    /** Structured logger; defaults to console. */
    log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void;
}
/**
 * Polls the webhook_events queue and runs each pending event's automation in a
 * Docker container. Concurrency-gated. Events whose token has no configured
 * automation are LEFT pending (not dropped) so config can be added later.
 */
export declare class RunnerWorker {
    private readonly config;
    private readonly db;
    private readonly run;
    private readonly uid;
    private readonly gid;
    private readonly log;
    private readonly byToken;
    private timer;
    private inFlight;
    private ticking;
    constructor(deps: RunnerDeps);
    start(): void;
    stop(): void;
    /** Single poll cycle. Exposed for tests. */
    tick(): Promise<void>;
    private process;
    private markProcessed;
    private markFailed;
}
export {};
