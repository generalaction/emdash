import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { runAgentInDocker } from './docker.js';
const defaultRun = (automation, oauthToken, uid, gid) => runAgentInDocker({ automation, oauthToken, uid, gid });
/**
 * Polls the webhook_events queue and runs each pending event's automation in a
 * Docker container. Concurrency-gated. Events whose token has no configured
 * automation are LEFT pending (not dropped) so config can be added later.
 */
export class RunnerWorker {
    config;
    db;
    run;
    uid;
    gid;
    log;
    byToken;
    timer = null;
    inFlight = 0;
    ticking = false;
    constructor(deps) {
        this.config = deps.config;
        this.db = deps.db ?? getDb();
        this.run = deps.run ?? defaultRun;
        this.uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
        this.gid = deps.gid ?? (typeof process.getgid === 'function' ? process.getgid() : 0);
        this.log =
            deps.log ??
                ((level, msg, extra) => {
                    const line = `[runner] ${msg}`;
                    if (level === 'error')
                        console.error(line, extra ?? '');
                    else if (level === 'warn')
                        console.warn(line, extra ?? '');
                    else
                        console.log(line, extra ?? '');
                });
        this.byToken = new Map(this.config.automations.map((a) => [a.token, a]));
    }
    start() {
        if (this.timer)
            return;
        if (!this.config.runner.enabled) {
            this.log('info', 'runner disabled (config.runner.enabled = false)');
            return;
        }
        if (!this.config.claudeOauthToken) {
            this.log('warn', 'runner enabled but claudeOauthToken is not set; runs will fail');
        }
        this.log('info', `runner started: ${this.byToken.size} automation(s), poll ${this.config.runner.pollIntervalMs}ms, maxConcurrent ${this.config.runner.maxConcurrent}`);
        this.timer = setInterval(() => void this.tick(), this.config.runner.pollIntervalMs);
        if (typeof this.timer.unref === 'function')
            this.timer.unref();
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /** Single poll cycle. Exposed for tests. */
    async tick() {
        if (this.ticking)
            return; // don't overlap ticks
        this.ticking = true;
        try {
            const capacity = this.config.runner.maxConcurrent - this.inFlight;
            if (capacity <= 0)
                return;
            const pending = await this.db
                .select({
                id: webhookEvents.id,
                token: webhookEvents.token,
            })
                .from(webhookEvents)
                .where(eq(webhookEvents.status, 'pending'))
                .orderBy(asc(webhookEvents.createdAt))
                .limit(capacity);
            for (const event of pending) {
                const automation = this.byToken.get(event.token);
                if (!automation) {
                    // Leave pending — config for this token may be added later.
                    this.log('warn', `no automation configured for token; leaving event pending`, {
                        eventId: event.id,
                    });
                    continue;
                }
                this.inFlight++;
                void this.process(event.id, automation).finally(() => {
                    this.inFlight--;
                });
            }
        }
        finally {
            this.ticking = false;
        }
    }
    async process(eventId, automation) {
        this.log('info', `running automation`, { eventId, repo: automation.repoPath });
        try {
            const result = await this.run(automation, this.config.claudeOauthToken ?? '', this.uid, this.gid);
            if (result.timedOut) {
                await this.markFailed(eventId, `timed out after ${automation.timeoutMs}ms`);
                return;
            }
            if (result.exitCode === 0) {
                await this.markProcessed(eventId);
                this.log('info', `automation succeeded`, { eventId });
            }
            else {
                const tail = result.stderr.slice(-2000) || result.stdout.slice(-2000);
                await this.markFailed(eventId, `exit ${result.exitCode}: ${tail}`);
                this.log('error', `automation failed`, { eventId, exitCode: result.exitCode });
            }
        }
        catch (err) {
            await this.markFailed(eventId, err instanceof Error ? err.message : String(err));
            this.log('error', `automation threw`, { eventId, err });
        }
    }
    async markProcessed(eventId) {
        await this.db
            .update(webhookEvents)
            .set({ status: 'processed', processedAt: Date.now(), error: null })
            .where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.status, 'pending')));
    }
    async markFailed(eventId, error) {
        await this.db
            .update(webhookEvents)
            .set({ status: 'failed', processedAt: Date.now(), error })
            .where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.status, 'pending')));
    }
}
