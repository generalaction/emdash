import type {
  DailyPoint,
  ModelUsage,
  ProjectUsage,
  RecentSession,
  UsageSnapshot,
} from '@shared/usage';
import { costOf, isPriced, normalizeModelFamily, PRICING_UPDATED } from './pricing';
import type { UsageRecord } from './types';

const TOP_PROJECTS = 8;
const RECENT_SESSIONS = 8;

function localParts(ts: string): { date: string; hour: number; time: number } | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { date: `${y}-${m}-${day}`, hour: d.getHours(), time: d.getTime() };
}

function basename(p: string | null): string {
  if (!p) return 'unknown';
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
}

export function aggregate(allRecords: UsageRecord[], now: Date): UsageSnapshot {
  // 1. Global dedup, first-wins.
  const byId = new Map<string, UsageRecord>();
  for (const r of allRecords) if (!byId.has(r.id)) byId.set(r.id, r);
  const records = [...byId.values()];

  // 2. Window boundaries (calendar, local time).
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfDay - now.getDay() * 86_400_000; // Sunday start
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const models = new Map<string, ModelUsage>();
  const projects = new Map<string, ProjectUsage>();
  const daily = new Map<string, DailyPoint>();
  const sessions = new Map<string, RecentSession>();
  const byHour = Array.from({ length: 24 }, () => 0);
  const unpriced = new Set<string>();

  const totals = { sessions: 0, messages: 0, tokens: 0, tokensWithCache: 0, cost: 0 };
  const windows = { today: 0, week: 0, month: 0, allTime: 0 };
  const sessionIds = new Set<string>();

  for (const r of records) {
    const buckets = {
      input: r.input,
      output: r.output,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite,
    };
    const cost = r.model ? costOf(buckets, r.model) : 0;
    const tokens = r.input + r.output;
    const withCache = tokens + r.cacheRead + r.cacheWrite;

    totals.tokens += tokens;
    totals.tokensWithCache += withCache;
    totals.cost += cost;
    if (r.isMessage) totals.messages += 1;
    if (r.sessionId) sessionIds.add(r.sessionId);

    // by model
    if (r.model) {
      if (!isPriced(r.model)) unpriced.add(r.model);
      const mu = models.get(r.model) ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        model: r.model,
        provider: r.provider,
        family: normalizeModelFamily(r.model),
        priced: isPriced(r.model),
        tokens: 0,
        cost: 0,
      };
      mu.input += r.input;
      mu.output += r.output;
      mu.cacheRead += r.cacheRead;
      mu.cacheWrite += r.cacheWrite;
      mu.tokens += tokens;
      mu.cost += cost;
      models.set(r.model, mu);
    }

    // by project
    if (r.cwd) {
      const pu = projects.get(r.cwd) ?? {
        path: r.cwd,
        name: basename(r.cwd),
        tokens: 0,
        cost: 0,
        sessions: 0,
      };
      pu.tokens += tokens;
      pu.cost += cost;
      projects.set(r.cwd, pu);
    }

    const parts = localParts(r.ts);
    if (parts) {
      byHour[parts.hour] += tokens;
      const dp = daily.get(parts.date) ?? { date: parts.date, cost: 0, tokens: 0 };
      dp.cost += cost;
      dp.tokens += tokens;
      daily.set(parts.date, dp);

      windows.allTime += cost;
      if (parts.time >= startOfDay) windows.today += cost;
      if (parts.time >= startOfWeek) windows.week += cost;
      if (parts.time >= startOfMonth) windows.month += cost;
    }

    // recent sessions
    if (r.sessionId) {
      const su = sessions.get(r.sessionId) ?? {
        id: r.sessionId,
        provider: r.provider,
        cwd: r.cwd,
        name: basename(r.cwd),
        model: r.model,
        lastTs: r.ts,
        messages: 0,
        cost: 0,
      };
      if (r.isMessage) su.messages += 1;
      su.cost += cost;
      if (r.model) su.model = r.model;
      if (r.ts > su.lastTs) su.lastTs = r.ts;
      sessions.set(r.sessionId, su);
    }
  }

  // project session counts
  const sessionCwd = new Map<string, string>();
  for (const r of records) if (r.sessionId && r.cwd) sessionCwd.set(r.sessionId, r.cwd);
  for (const cwd of sessionCwd.values()) {
    const pu = projects.get(cwd);
    if (pu) pu.sessions += 1;
  }

  totals.sessions = sessionIds.size;

  const byProjectAll = [...projects.values()].sort((a, b) => b.cost - a.cost);
  const byProject = byProjectAll.slice(0, TOP_PROJECTS);
  const rest = byProjectAll.slice(TOP_PROJECTS);
  if (rest.length) {
    byProject.push({
      path: '',
      name: 'other',
      tokens: rest.reduce((s, p) => s + p.tokens, 0),
      cost: rest.reduce((s, p) => s + p.cost, 0),
      sessions: rest.reduce((s, p) => s + p.sessions, 0),
    });
  }

  return {
    generatedAt: now.toISOString(),
    pricingUpdated: PRICING_UPDATED,
    totals,
    windows,
    byModel: [...models.values()].sort((a, b) => b.cost - a.cost),
    byProject,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byHour,
    recentSessions: [...sessions.values()]
      .sort((a, b) => b.lastTs.localeCompare(a.lastTs))
      .slice(0, RECENT_SESSIONS),
    unpricedModels: [...unpriced],
  };
}
