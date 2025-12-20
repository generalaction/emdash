import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BarChart3, CalendarRange, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { Separator } from './ui/separator';
import { providerConfig } from '../lib/providerConfig';

type UsageSummary = {
  disabled: boolean;
  range: {
    start: string;
    end: string;
    days: number;
  };
  totals: {
    projects: number;
    workspaces: number;
    conversations: number;
    messages: number;
    agentRuns: number;
  };
  workspaces: {
    multiAgent: number;
  };
  messages: {
    user: number;
    agent: number;
  };
  series: {
    messages: Array<{ date: string; total: number; user: number; agent: number }>;
    workspaces: Array<{ date: string; total: number; multiAgent: number; agentRuns: number }>;
  };
  providers: Array<{ id: string; runs: number }>;
};

type UsageRange = {
  start?: string;
  end?: string;
};

type RangePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

type Metric = {
  label: string;
  value: number;
  helper?: string | null;
};

type ChartPoint = { date: string; value: number };

type ChartCardProps = {
  title: string;
  subtitle?: string;
  total: number;
  average: number;
  rangeLabel: string;
  startLabel: string;
  endLabel: string;
  children: React.ReactNode;
};

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatCount = (value: number) => new Intl.NumberFormat().format(value);

const formatDecimal = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  });
};

const resolveProviderLabel = (id: string) => {
  const key = id as keyof typeof providerConfig;
  if (providerConfig[key]?.name) return providerConfig[key].name;
  if (!id) return 'Unknown';
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatDayLabel = (value: string, opts?: Intl.DateTimeFormatOptions) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, opts).format(date);
};

const buildRangeLabel = (start: string, end: string) => {
  if (!start || !end) return 'All time';
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startLabel = formatDayLabel(start, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
  const endLabel = formatDayLabel(end, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} - ${endLabel}`;
};

const buildPresetRange = (preset: RangePreset): UsageRange => {
  if (preset === 'all') return {};
  const today = new Date();
  const end = toDateInputValue(today);
  const daysBack = preset === '7d' ? 6 : preset === '30d' ? 29 : preset === '90d' ? 89 : 29;
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
  return { start: toDateInputValue(startDate), end };
};

const buildLinePath = (values: number[], width: number, height: number, padding: number) => {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : innerWidth;
  return values
    .map((value, index) => {
      const x = padding + index * step;
      const scaled = (value - min) / range;
      const y = padding + (1 - scaled) * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
};

const buildAreaPath = (linePath: string, width: number, height: number, padding: number) => {
  if (!linePath) return '';
  const left = padding;
  const right = width - padding;
  const bottom = height - padding;
  return `${linePath} L ${right} ${bottom} L ${left} ${bottom} Z`;
};

const UsageLineChart: React.FC<{
  values: number[];
  accentClass?: string;
}> = ({ values, accentClass = 'text-primary' }) => {
  const gradientId = useId();
  const width = 160;
  const height = 56;
  const padding = 6;
  const linePath = buildLinePath(values, width, height, padding);
  const areaPath = buildAreaPath(linePath, width, height, padding);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full"
      role="img"
      aria-label="Usage trend"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="text-muted-foreground/20">
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="currentColor" />
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="currentColor"
        />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="currentColor"
        />
      </g>
      <g className={accentClass}>
        {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
        {linePath ? (
          <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" />
        ) : null}
      </g>
    </svg>
  );
};

const UsageBarChart: React.FC<{
  values: number[];
  accentClass?: string;
}> = ({ values, accentClass = 'text-primary' }) => {
  const width = 160;
  const height = 56;
  const padding = 6;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const max = Math.max(...values, 1);
  const barCount = values.length || 1;
  const barWidth = innerWidth / barCount;
  const barGap = Math.max(1, barWidth * 0.25);
  const actualBarWidth = Math.max(2, barWidth - barGap);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full"
      role="img"
      aria-label="Usage volume"
    >
      <g className="text-muted-foreground/20">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" />
      </g>
      <g className={accentClass}>
        {values.map((value, index) => {
          const normalized = max > 0 ? value / max : 0;
          const barHeight = Math.max(2, normalized * innerHeight);
          const x = padding + index * barWidth + barGap / 2;
          const y = height - padding - barHeight;
          return (
            <rect
              key={`${index}-${value}`}
              x={x}
              y={y}
              width={actualBarWidth}
              height={barHeight}
              rx={2}
              className="fill-current"
            />
          );
        })}
      </g>
    </svg>
  );
};

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  total,
  average,
  rangeLabel,
  startLabel,
  endLabel,
  children,
}) => {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{title}</div>
          {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">{rangeLabel}</div>
          <div className="text-sm font-semibold text-foreground">{formatCount(total)}</div>
          <div className="text-[11px] text-muted-foreground">
            Avg {formatDecimal(average)} / day
          </div>
        </div>
      </div>
      <div className="mt-3">{children}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
};

interface UsageDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UsageDashboardModal: React.FC<UsageDashboardModalProps> = ({ isOpen, onClose }) => {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [activeRange, setActiveRange] = useState<UsageRange>(() => buildPresetRange('30d'));
  const shouldReduceMotion = useReducedMotion();
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const loadSummary = useCallback(
    async (range: UsageRange) => {
      if (!window?.electronAPI?.getUsageSummary) {
        setError('Usage summary is unavailable in this build.');
        setSummary(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.getUsageSummary(range);
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to load usage summary.');
        }
        setSummary(result.summary ?? null);
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load usage summary.';
        setError(message);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (rangePreset === 'custom') return;
    setActiveRange(buildPresetRange(rangePreset));
  }, [rangePreset]);

  useEffect(() => {
    if (!isOpen) return;
    void loadSummary(activeRange);
  }, [isOpen, activeRange, loadSummary]);

  useEffect(() => {
    if (!isOpen) return;
    lastFocusedRef.current = document.activeElement as HTMLElement;
    return () => {
      lastFocusedRef.current?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const applyCustomRange = () => {
    if (!customStart || !customEnd) return;
    const start = customStart <= customEnd ? customStart : customEnd;
    const end = customStart <= customEnd ? customEnd : customStart;
    setActiveRange({ start, end });
  };

  const rangeLabel = summary?.range
    ? buildRangeLabel(summary.range.start, summary.range.end)
    : 'All time';
  const rangeStartLabel = summary?.range
    ? formatDayLabel(summary.range.start, { month: 'short', day: 'numeric' })
    : '';
  const rangeEndLabel = summary?.range
    ? formatDayLabel(summary.range.end, { month: 'short', day: 'numeric' })
    : '';

  const metrics = useMemo<Metric[]>(() => {
    if (!summary) return [];
    return [
      { label: 'Projects', value: summary.totals.projects, helper: 'Added in range' },
      {
        label: 'Workspaces',
        value: summary.totals.workspaces,
        helper: summary.workspaces.multiAgent
          ? `${formatCount(summary.workspaces.multiAgent)} multi-agent`
          : null,
      },
      { label: 'Agent runs', value: summary.totals.agentRuns, helper: 'Estimated from workspaces' },
      { label: 'Conversations', value: summary.totals.conversations, helper: 'Active threads' },
      {
        label: 'Messages',
        value: summary.totals.messages,
        helper: `${formatCount(summary.messages.user)} user / ${formatCount(
          summary.messages.agent
        )} agent`,
      },
      {
        label: 'Providers used',
        value: summary.providers.length,
        helper: summary.providers[0]
          ? `Top: ${resolveProviderLabel(summary.providers[0].id)}`
          : null,
      },
    ];
  }, [summary]);

  const messageSeries = useMemo<ChartPoint[]>(() => {
    return summary?.series.messages.map((point) => ({ date: point.date, value: point.total })) || [];
  }, [summary]);

  const runSeries = useMemo<ChartPoint[]>(() => {
    return (
      summary?.series.workspaces.map((point) => ({ date: point.date, value: point.agentRuns })) || []
    );
  }, [summary]);

  const busiestMessageDay = useMemo(() => {
    if (!summary?.series.messages.length) return null;
    return summary.series.messages.reduce(
      (best, current) => (current.total > best.total ? current : best),
      summary.series.messages[0]
    );
  }, [summary]);

  const avgMessagesPerDay = summary?.range.days
    ? summary.totals.messages / summary.range.days
    : 0;
  const avgRunsPerDay = summary?.range.days ? summary.totals.agentRuns / summary.range.days : 0;
  const multiAgentShare = summary?.totals.workspaces
    ? (summary.workspaces.multiAgent / summary.totals.workspaces) * 100
    : 0;

  const providerRows = summary?.providers.slice(0, 6) || [];
  const maxProviderRuns = providerRows[0]?.runs || 0;

  const lastUpdatedLabel = lastUpdatedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(lastUpdatedAt))
    : '';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Usage dashboard"
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8 }}
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="mx-4 w-full max-w-5xl overflow-hidden rounded-3xl border border-border/60 bg-background shadow-2xl"
          >
            <div className="flex max-h-[85vh] flex-col">
              <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <BarChart3 className="h-4 w-4" />
                    </span>
                    <span>Usage dashboard</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Local-only usage insights from your projects and chats. No telemetry required.
                  </p>
                  {lastUpdatedLabel ? (
                    <p className="text-[11px] text-muted-foreground">
                      Last updated {lastUpdatedLabel}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8"
                  aria-label="Close usage dashboard"
                >
                  <X className="h-4 w-4" />
                </Button>
              </header>

              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                      <CalendarRange className="h-3 w-3" />
                      <span>{rangeLabel}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center rounded-full border border-border/60 bg-muted/30 p-1">
                      {([
                        { id: '7d', label: '7D' },
                        { id: '30d', label: '30D' },
                        { id: '90d', label: '90D' },
                        { id: 'all', label: 'All' },
                        { id: 'custom', label: 'Custom' },
                      ] as Array<{ id: RangePreset; label: string }>).map((preset) => (
                        <Button
                          key={preset.id}
                          type="button"
                          size="sm"
                          variant={rangePreset === preset.id ? 'secondary' : 'ghost'}
                          className="h-7 rounded-full px-3 text-xs"
                          aria-pressed={rangePreset === preset.id}
                          onClick={() => setRangePreset(preset.id)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {rangePreset === 'custom' ? (
                  <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex min-w-[160px] flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor="usage-start-date">
                        Start date
                      </label>
                      <Input
                        id="usage-start-date"
                        type="date"
                        value={customStart}
                        onChange={(event) => setCustomStart(event.target.value)}
                      />
                    </div>
                    <div className="flex min-w-[160px] flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor="usage-end-date">
                        End date
                      </label>
                      <Input
                        id="usage-end-date"
                        type="date"
                        value={customEnd}
                        onChange={(event) => setCustomEnd(event.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={applyCustomRange}
                      disabled={!customStart || !customEnd}
                    >
                      Apply range
                    </Button>
                  </div>
                ) : null}

                {loading ? (
                  <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner size="sm" />
                    Refreshing usage data...
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}

                {!error && summary?.disabled ? (
                  <div className="mt-6 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                    Usage data is unavailable because the local database is disabled.
                  </div>
                ) : null}

                {!error && summary && !summary.disabled ? (
                  <div className="mt-6 space-y-6">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {metrics.map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-2xl border border-border/60 bg-gradient-to-br from-muted/30 via-background to-background p-4"
                        >
                          <div className="text-xs text-muted-foreground">{metric.label}</div>
                          <div className="text-2xl font-semibold text-foreground">
                            {formatCount(metric.value)}
                          </div>
                          {metric.helper ? (
                            <div className="text-[11px] text-muted-foreground">
                              {metric.helper}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <Separator className="border-border/60" />

                    <div className="grid gap-4 lg:grid-cols-2">
                      <ChartCard
                        title="Message volume"
                        subtitle="Messages per day"
                        total={summary.totals.messages}
                        average={avgMessagesPerDay}
                        rangeLabel={rangeLabel}
                        startLabel={rangeStartLabel}
                        endLabel={rangeEndLabel}
                      >
                        <UsageLineChart values={messageSeries.map((point) => point.value)} />
                      </ChartCard>

                      <ChartCard
                        title="Agent runs"
                        subtitle="Estimated runs per day"
                        total={summary.totals.agentRuns}
                        average={avgRunsPerDay}
                        rangeLabel={rangeLabel}
                        startLabel={rangeStartLabel}
                        endLabel={rangeEndLabel}
                      >
                        <UsageBarChart values={runSeries.map((point) => point.value)} />
                      </ChartCard>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                      <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-foreground">Top providers</div>
                            <div className="text-xs text-muted-foreground">
                              Most common agent runs in the range
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {providerRows.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No provider activity yet.
                            </p>
                          ) : (
                            providerRows.map((provider) => {
                              const width =
                                maxProviderRuns > 0
                                  ? `${Math.round((provider.runs / maxProviderRuns) * 100)}%`
                                  : '0%';
                              return (
                                <div key={provider.id} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">
                                      {resolveProviderLabel(provider.id)}
                                    </span>
                                    <span className="font-medium text-foreground">
                                      {formatCount(provider.runs)} runs
                                    </span>
                                  </div>
                                  <div className="h-2 rounded-full bg-muted/40">
                                    <div
                                      className="h-2 rounded-full bg-primary/60"
                                      style={{ width }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                        <div className="text-sm font-medium text-foreground">Insights</div>
                        <div className="mt-3 space-y-3 text-xs text-muted-foreground">
                          <div className="flex items-center justify-between">
                            <span>Busy day</span>
                            <span className="font-medium text-foreground">
                              {busiestMessageDay
                                ? `${formatDayLabel(busiestMessageDay.date, {
                                    month: 'short',
                                    day: 'numeric',
                                  })} (${formatCount(busiestMessageDay.total)})`
                                : 'No data'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Avg messages / day</span>
                            <span className="font-medium text-foreground">
                              {formatDecimal(avgMessagesPerDay)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Avg runs / day</span>
                            <span className="font-medium text-foreground">
                              {formatDecimal(avgRunsPerDay)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Multi-agent share</span>
                            <span className="font-medium text-foreground">
                              {formatDecimal(multiAgentShare)}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Top provider</span>
                            <span className="font-medium text-foreground">
                              {providerRows[0]
                                ? resolveProviderLabel(providerRows[0].id)
                                : 'No data'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default UsageDashboardModal;
