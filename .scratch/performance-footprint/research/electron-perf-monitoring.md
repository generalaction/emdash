# Continuous self-measurement of CPU, memory, and subprocess footprint in an Electron app

Research notes, 2026-08-06. All claims are cited to primary sources: Electron docs, Node.js docs,
W3C specs, `microsoft/vscode` source on `main`, react.dev, and web.dev (Google owns the INP metric
definition). Context: emdash is an Electron app that runs ~14 persistent Node worker child
processes plus many short-lived git subprocesses.

---

## 1. Electron / Chromium / Node APIs

### 1.1 `app.getAppMetrics()` — per-process CPU + memory for Chromium-managed processes

- **What it measures.** Returns a `ProcessMetric[]` with "memory and CPU usage statistics of all
  the processes associated with the app"
  ([Electron `app` docs](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)).
  Each `ProcessMetric` carries `pid`, `type` (`Browser`, `Tab`, `Utility`, `GPU`, `Zygote`, …),
  `serviceName`/`name`, `creationTime`, `cpu`, `memory`, and platform extras (`sandboxed`,
  `integrityLevel`)
  ([ProcessMetric structure](https://www.electronjs.org/docs/latest/api/structures/process-metric)).
  - `cpu.percentCPUUsage` is the percentage used *since the last call to `getCPUUsage`* (first call
    returns 0), plus `cumulativeCPUUsage` (total CPU-seconds) and `idleWakeupsPerSecond` (always 0
    on Windows) ([CPUUsage structure](https://www.electronjs.org/docs/latest/api/structures/cpu-usage)).
    So it is inherently interval-based: poll it on a timer and you get per-interval CPU%.
  - `memory.workingSetSize` / `peakWorkingSetSize` (and `privateBytes` on Windows), all in
    kilobytes ([MemoryInfo structure](https://www.electronjs.org/docs/latest/api/structures/memory-info)).
- **Process coverage.** Only processes in Chromium's process model: the main process (`Browser`),
  renderers (`Tab`), GPU, and Chromium utility processes. Crucially, processes forked with
  Electron's `utilityProcess.fork()` **do** appear — the `serviceName` option is documented as the
  "Name of the process that will appear in `name` property of ProcessMetric returned by
  app.getAppMetrics" ([utilityProcess docs](https://www.electronjs.org/docs/latest/api/utility-process)).
  Plain `child_process.spawn/fork` children are ordinary OS children, not Chromium-managed
  processes (`utilityProcess` is explicitly the variant that "uses Services API from Chromium to
  launch the child process", ibid.), so they are **not** included — nor are grandchildren such as
  git's own helpers.
- **Cost.** A synchronous main-process call that reads process metrics; designed for polling (the
  CPU number is defined by the delta between calls). No documented overhead concerns.
- **Stability.** Stable documented API, main process only, no experimental flag
  ([Electron `app` docs](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)).

### 1.2 `process.getProcessMemoryInfo()` and the other Electron `process` extensions

Electron extends the Node `process` object in every process type; a documented subset — including
`getCPUUsage()`, `getHeapStatistics()`, `getBlinkMemoryInfo()`, `getProcessMemoryInfo()`,
`getSystemMemoryInfo()`, `getCreationTime()` — is available **even in sandboxed renderers**
([Electron `process` docs, "Sandbox"](https://www.electronjs.org/docs/latest/api/process#sandbox)).

- **`process.getProcessMemoryInfo()`** — async, resolves with memory statistics of the *current*
  process in kilobytes; must be called after app `ready`. Caveat straight from the docs: "Chromium
  does not provide `residentSet` value for macOS" because of in-memory page compression; on macOS
  "`private` memory is more representative of the actual pre-compression memory usage"
  ([Electron `process` docs](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)).
- **`process.getCPUUsage()`** — same `CPUUsage` shape as above, per current process, delta since
  last call ([CPUUsage structure](https://www.electronjs.org/docs/latest/api/structures/cpu-usage)).
- **`process.getHeapStatistics()`** — V8 heap stats in kilobytes (Electron's mirror of Node's
  `v8.getHeapStatistics()`, usable in sandboxed renderers where `node:v8` is not)
  ([Electron `process` docs](https://www.electronjs.org/docs/latest/api/process#processgetheapstatistics)).
- **`process.getBlinkMemoryInfo()`** — Blink allocated/total memory, "useful for debugging
  rendering / DOM related memory issues" (ibid.).
- **Coverage:** each call reports the calling process only — so main, each renderer, and each
  Electron `utilityProcess` must sample themselves and ship the numbers over IPC.
- **Cost/stability:** lightweight per-process getters; stable documented APIs.

### 1.3 Node `process.memoryUsage()` / `process.cpuUsage()` — any Node context, incl. plain child processes

- **`process.memoryUsage()`** returns `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`
  (bytes). Documented cost warning: it "iterates over each page to gather information about memory
  usage which might be slow depending on the program memory allocations"
  ([Node `process` docs](https://nodejs.org/api/process.html#processmemoryusage)).
- **`process.memoryUsage.rss()`** (added v15.6.0/v14.18.0) returns just RSS and "is faster" than
  the full call — the right primitive for frequent sampling
  ([Node `process` docs](https://nodejs.org/api/process.html#processmemoryusagerss)).
- **`process.cpuUsage([previousValue])`** returns user/system CPU time in microseconds and accepts
  the previous reading to produce a diff — the standard pattern for interval CPU% in a Node child
  ([Node `process` docs](https://nodejs.org/api/process.html#processcpuusagepreviousvalue)).
- **`process.resourceUsage()`** exposes `uv_getrusage`, including `maxRSS` (peak RSS in KiB)
  ([Node `process` docs](https://nodejs.org/api/process.html#processresourceusage)).
- **Coverage:** works in every Node context — Electron main, `utilityProcess` children, and the
  ~14 plain Node worker child processes. This is the only self-measurement path for
  `child_process`-spawned workers; each worker samples itself and reports to the parent.
- **Cost/stability:** stable since early Node; `rss()`/`cpuUsage()` are cheap; the full
  `memoryUsage()` has the documented page-iteration cost. On Linux glibc, RSS can grow from
  allocator fragmentation while `heapTotal` stays flat (documented caveat, ibid.).

### 1.4 `webFrame.getResourceUsage()` — Blink cache memory, renderer only

Returns counts/sizes of "Blink's internal memory caches" per category (`images`, `cssStyleSheets`,
`xslStyleSheets`, `fonts`, `other`), each with `count`, `size`, `liveSize`
([Electron `webFrame` docs](https://www.electronjs.org/docs/latest/api/web-frame#webframegetresourceusage)).
Renderer-process only (module runs in the current frame; with context isolation it must be called
from the preload script, ibid.). Companion `webFrame.clearCache()` frees those caches, with the
documented warning that blindly calling it makes the app slower because the caches refill (ibid.).
Narrow diagnostic value — it covers cache memory, not JS heap or process RSS. Stable API, cheap
synchronous call.

### 1.5 `contentTracing` — whole-app Chromium tracing (session profiler, not a monitor)

The `contentTracing` module "collect[s] tracing data from Chromium to find performance bottlenecks
and slow operations"; `startRecording()` starts "on all processes" and `stopRecording()` writes a
trace file viewable in `chrome://tracing`/Perfetto
([Electron `contentTracing` docs](https://www.electronjs.org/docs/latest/api/content-tracing)).
Design notes from the same page:

- Child processes "cache trace data and only rarely flush … to minimize the runtime overhead of
  tracing since sending trace data over IPC can be an expensive operation" — i.e., overhead is
  managed but real; this is a bounded recording session, not a continuous counter source.
- `contentTracing.enableHeapProfiling()` (allocation profiling for MemoryInfra traces, equivalent
  to Chrome's `--memlog`) is marked **Experimental**, added in Electron ≥ 43 (ibid.).
- **Coverage:** all Chromium processes (main, renderers, GPU, utility). Not plain Node children.
- **Verdict:** dev-harness / on-demand diagnostics only; not suitable to leave running.

### 1.6 `v8.getHeapStatistics()` — V8 heap detail in any Node context

Returns heap totals plus leak-relevant fields: `number_of_native_contexts` ("Increase of this
number over time indicates a memory leak") and `number_of_detached_contexts` ("being non-zero
indicates a potential memory leak"), `external_memory`, `malloced_memory`, `heap_size_limit`, etc.
([Node `v8` docs](https://nodejs.org/api/v8.html#v8getheapstatistics)). Synchronous, present since
Node v1.0.0 (ibid.) — cheap enough to sample every few seconds in main and every worker. In
sandboxed renderers use Electron's `process.getHeapStatistics()` instead (§1.2).

### 1.7 Node `perf_hooks` — event-loop delay, ELU, PerformanceObserver

- **`perf_hooks.monitorEventLoopDelay([options])`** (added v11.10.0) returns an `ELDHistogram`
  that "samples and reports the event loop delay over time" in nanoseconds; by default the
  histogram is updated by a timer at the configured `resolution` (default **10 ms**); an
  alternative `samplePerIteration: true` mode samples via `uv_prepare_t`/`uv_check_t` hooks and
  "does not keep the loop alive … when the application is idle"
  ([Node `perf_hooks` docs](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)).
  Histogram gives `min/max/mean/stddev/percentile(n)`. Designed as an always-on health signal.
- **`performance.eventLoopUtilization()` / `perf_hooks.eventLoopUtilization()`** (added
  v14.10.0/v12.19.0; module-level alias added v25.2.0/v24.12.0) returns cumulative `idle`/`active`
  time and a computed `utilization` ratio. The docs stress it "only measures event loop statistics
  and not CPU usage" — e.g. a `spawnSync` that blocks the loop yields ELU = 1 even though the CPU
  is idle ([Node `perf_hooks` docs](https://nodejs.org/api/perf_hooks.html#perf_hookseventlooputilizationutilization1-utilization2)).
  Two cheap reads + subtraction per sample; ideal companion to `cpuUsage()`.
- **`PerformanceObserver`** in Node supports entry types `'dns'`, `'function'`, `'gc'`, `'http'`,
  `'http2'`, `'mark'`, `'measure'`, `'net'`, `'resource'` — **not** `'longtask'`, which the Long
  Tasks spec defines for Window contexts only
  ([Node `perf_hooks` docs](https://nodejs.org/api/perf_hooks.html#performanceobserversupportedentrytypes);
  [Long Tasks spec §4](https://w3c.github.io/longtasks/#sec-processing-model)). `'gc'` entries
  (with `detail.kind`/`detail.flags` since v16) give per-collection pause durations. The docs warn
  that "`PerformanceObserver` instances introduce their own additional performance overhead" and
  should be disconnected when not needed
  ([Node `perf_hooks` docs](https://nodejs.org/api/perf_hooks.html#class-perf_hooksperformanceobserver)) —
  a narrowly-scoped `'gc'` observer is the acceptable always-on use.

---

## 2. How VS Code does it

All paths below verified against `microsoft/vscode` `main` (fetched 2026-08-06).

### 2.1 Process explorer: OS-level process-tree polling, not Chromium metrics

- UI: [`src/vs/workbench/contrib/processExplorer/browser/processExplorerControl.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/processExplorer/browser/processExplorerControl.ts)
  renders a tree with columns "Process Name / CPU (%) / Memory (MB) / PID" and re-polls in a loop
  through a `Delayer(1000)` — i.e., roughly one refresh per second, only while the explorer is
  open. Context-menu actions: kill/force-kill, copy, and attach the Node debugger to child
  processes whose command line matches `--inspect`.
- Data: [`src/vs/platform/process/electron-main/processMainService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/process/electron-main/processMainService.ts)
  `resolveProcesses()` calls `listProcesses(process.pid)` and merges in friendly names for windows
  and for `UtilityProcess.getAll()` (their pid→name map).
- The actual sampler, [`src/vs/base/node/ps.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/node/ps.ts):
  - **Windows:** the native module `@vscode/windows-process-tree`
    (`getProcessList` + `getProcessCpuUsage`).
  - **macOS/Linux:** shells out to `ps -ax -o pid=,ppid=,pcpu=,pmem=,command=` and reconstructs
    the tree by `ppid`, rooted at VS Code's own pid.
  - **Linux CPU fixup:** the in-source comment notes "The cpu usage value reported on Linux is
    the average over the process lifetime, recalculate the usage over a one second interval" via a
    helper script (`cpuUsage.sh`).
  - Process naming parses Chromium's `--type=` flags (`renderer` → `window`, `utility` →
    `utility-process`/`utility-network-service`, etc.) and detects things like conpty and the
    crash handler by command-line regex.
- **Takeaway:** for the *full* subprocess footprint (including plain Node children, shells, and
  grandchildren), VS Code deliberately uses OS-level observation rather than
  `app.getAppMetrics()`, and only runs it while a human is looking at it.

### 2.2 Startup performance instrumentation: perf marks + heavily sampled telemetry

- Marks are recorded via VS Code's own perf-marks helper
  ([`src/vs/base/common/performance.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/performance.ts))
  across main/renderer/extension host, and aggregated into `IStartupMetrics` by
  [`src/vs/workbench/services/timer/browser/timerService.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/timer/browser/timerService.ts).
- That service sends startup telemetry for only **~3% of sessions**:
  `_rndValueShouldSendTelemetry = Math.random() < .03` (ibid.).
- It also computes `perfBaseline` — a fibonacci micro-benchmark run in a throwaway worker *after*
  startup settles ("computing it takes away CPU resources", returns −1 "if the machine is
  hopelessly slow", ibid.) — used to normalize other measurements against machine speed.
- One-shot reporting lives in
  [`startupTimings.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/performance/browser/startupTimings.ts),
  and the human-readable "Startup Performance" editor in
  [`perfviewEditor.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/performance/browser/perfviewEditor.ts).
  The same contrib folder has an input-latency sampler,
  [`inputLatencyContrib.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/performance/browser/inputLatencyContrib.ts).

### 2.3 Extension host: cheap liveness signal, expensive profiler only on trigger

[`src/vs/workbench/contrib/extensions/electron-browser/extensionsAutoProfiler.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/extensions/electron-browser/extensionsAutoProfiler.ts):

- Continuously listens to `onDidChangeResponsiveChange` (a liveness signal from the extension-host
  service — cheap, always on).
- Only when the host turns *unresponsive* does it attach `ExtensionHostProfiler`
  (`src/vs/workbench/services/extensions/electron-browser/extensionHostProfiler.ts`, a V8
  inspector CPU profile over the host's inspect port), profile for ~5 s or until responsive again,
  then analyze the profile per-extension, emit an `exthostunresponsive` telemetry event, and
  notify the user only if one extension consumed ≥ 95% of ≥ 5 s.
- It gates all of this on `perfBaseline` — machines that are "too slow for profiling" never
  profile (ibid.).
- **Takeaway:** the VS Code pattern for worker-style processes is *trigger-based profiling on top
  of an always-on cheap signal*, never continuous profiling.

---

## 3. Counting child-process spawns: instrumenting the spawn seam vs OS observation

### 3.1 Instrumenting the seam

Node's own docs establish that the seam is narrow: `exec()`, `execFile()`, and `fork()` "are
implemented on top of `child_process.spawn()` or `child_process.spawnSync()`"
([Node `child_process` docs](https://nodejs.org/api/child_process.html)). So a wrapper around
`spawn`/`spawnSync` (ideally an owned wrapper module that all app code imports, rather than
monkey-patching the builtin) observes every subprocess the instrumented process creates. Each
`ChildProcess` emits `'spawn'` and `'exit'`/`'close'` events
([Node `child_process` docs](https://nodejs.org/api/child_process.html#class-childprocess)), giving
exact lifetimes.

- **Pros:** exact counts including sub-second processes (git invocations routinely finish faster
  than any polling interval); zero polling cost — cost is O(spawns), a counter increment and an
  event listener per spawn; rich attribution (command, argv, cwd, calling feature, duration, exit
  code).
- **Cons:** only sees spawns made *by the instrumented process* — each of emdash's worker
  processes needs the same wrapper; blind to grandchildren spawned by external binaries (e.g. git
  invoking `ssh` or credential helpers); a monkey-patch (as opposed to an owned wrapper seam) is
  invasive and interacts badly with security-sensitive spawn paths.

### 3.2 OS-level observation

The VS Code approach (§2.1): periodically enumerate the OS process tree rooted at your own pid via
`ps` / `@vscode/windows-process-tree`
([`src/vs/base/node/ps.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/node/ps.ts)).

- **Pros:** sees *everything* alive at sample time — including grandchildren and processes no app
  code knows about; needs no cooperation from workers; also yields CPU/memory per process, which
  the spawn seam cannot.
- **Cons:** sampling misses any process shorter than the interval (most git subprocesses); each
  sample itself spawns a process (`ps`) or runs native enumeration — VS Code only pays this while
  the process-explorer window is open, at 1 Hz; per-process CPU needs platform fixups (the Linux
  lifetime-average problem VS Code works around with a 1-second re-sample, ibid.).

### 3.3 Conclusion

The two are complementary, not alternatives: the spawn seam gives exact *counts and lifecycle* of
own-code spawns (the right always-on production counter); OS-tree polling gives *point-in-time
CPU/RSS of the whole tree including grandchildren* (the right on-demand/dev-harness view). A third
option for the persistent workers specifically: migrating them from `child_process` to
`utilityProcess.fork()` makes them visible to `app.getAppMetrics()` with a stable `serviceName`
and adds crash reporting via the app's `child-process-gone` event
([Electron `utilityProcess` docs](https://www.electronjs.org/docs/latest/api/utility-process)).

---

## 4. Renderer-side monitoring

### 4.1 Long Tasks API (`PerformanceObserver`, `type: 'longtask'`)

The W3C Long Tasks spec surfaces any event-loop task (plus its microtask checkpoint) whose
duration exceeds **50 ms**, with 1 ms granularity and attribution
([Long Tasks API, W3C Editor's Draft](https://w3c.github.io/longtasks/)). The spec's own
motivation section explains why the observer is preferable to a polling watchdog: timer-based
long-task detection "prevents quiescence and long idle blocks … it's bad for battery life"
([spec §1, Introduction](https://w3c.github.io/longtasks/#intro)). Observers can use
`buffered: true` to receive tasks from before registration (spec usage example, ibid.).
`'longtask'` is defined for Window contexts (spec §4) — i.e., Electron renderers, not the main
process (§1.7). Spec status: W3C Editor's Draft, shipped in Chromium — stable in practice for an
Electron app that controls its Chromium version. Push-based and threshold-gated, so cheap enough
to leave on.

### 4.2 Event Timing / INP

INP (the Google-defined responsiveness metric) is "the longest interaction observed, ignoring
outliers" (one outlier ignored per 50 interactions), where an interaction's latency runs from
input to next paint; ≤ 200 ms is "good" ([web.dev: INP](https://web.dev/articles/inp)). Practical
API facts from the same primary source: `event` entries below **104 ms** are not reported by
default; `durationThreshold` can lower that with a floor of **16 ms**; also observe `first-input`;
report on `visibilitychange` rather than unload; keep only the worst-N (~10) interactions to
approximate p98; Google's [`web-vitals` library](https://github.com/GoogleChrome/web-vitals) is
the reference implementation (ibid.). The 104 ms default threshold means the default configuration
observes only genuinely slow interactions — negligible steady-state cost, designed for field/RUM
use.

### 4.3 React `<Profiler>`

React's `<Profiler>` calls `onRender` with `actualDuration`/`baseDuration` per commit of the
wrapped tree. Two documented caveats: "Profiling adds some additional overhead, so **it is
disabled in the production build by default**" — production profiling requires opting into a
special profiling build — and "although `<Profiler>` is a lightweight component … Each use adds
some CPU and memory overhead" ([react.dev: `<Profiler>`](https://react.dev/reference/react/Profiler)).
So: normal production builds silently no-op profiling; shipping the profiling build app-wide to
all users trades a permanent overhead for data. Dev builds get the interactive React DevTools
profiler and performance tracks for free (ibid.).

---

## 5. Production-safety summary (telemetry must remain optional)

| Mechanism | Coverage | Always-on in production? |
| --- | --- | --- |
| `app.getAppMetrics()` polling | main/renderers/GPU/`utilityProcess` | Yes — interval getter, poll at 10–60 s ([docs](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)) |
| Electron `process.get*` self-sampling | calling process only | Yes — lightweight getters ([docs](https://www.electronjs.org/docs/latest/api/process)) |
| Node `memoryUsage.rss()` + `cpuUsage(prev)` in workers | each Node child | Yes — `rss()` documented as the fast variant ([docs](https://nodejs.org/api/process.html#processmemoryusagerss)) |
| `v8.getHeapStatistics()` | calling process | Yes — sync, cheap ([docs](https://nodejs.org/api/v8.html#v8getheapstatistics)) |
| `monitorEventLoopDelay` + `eventLoopUtilization` | calling process | Yes — built for continuous sampling ([docs](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)) |
| Spawn-seam counters | own-code spawns | Yes — O(spawns) counter, no polling (§3.1) |
| Long-task + event-timing observers | renderer | Yes — push-based, ≥50 ms / ≥104 ms thresholds ([spec](https://w3c.github.io/longtasks/), [web.dev](https://web.dev/articles/inp)) |
| OS process-tree polling (`ps`) | full tree incl. grandchildren | On-demand only — VS Code runs it at 1 Hz only while the explorer is open (§2.1) |
| `contentTracing` | all Chromium processes | No — bounded recording sessions, dev/diagnostics only ([docs](https://www.electronjs.org/docs/latest/api/content-tracing)) |
| V8 inspector CPU profiling | targeted process | Trigger-only — VS Code profiles the extension host only after an unresponsive signal (§2.3) |
| React `<Profiler>` | renderer React tree | No by default — production builds disable it; profiling build has permanent overhead ([react.dev](https://react.dev/reference/react/Profiler)) |
| Node `PerformanceObserver` (broad) | calling process | Narrow scopes only — docs warn observers add overhead; a `'gc'`-only observer is fine ([docs](https://nodejs.org/api/perf_hooks.html#class-perf_hooksperformanceobserver)) |

Everything in the "Yes" rows is sampling/counting with no documented pathological cost, so the
gate is purely the existing telemetry opt-in (and, per VS Code's precedent, session-level sampling
— they ship startup metrics for ~3% of sessions, §2.2).

---

## Implications for emdash

**Key structural fact:** emdash's ~14 persistent workers are plain Node `child_process` children,
so `app.getAppMetrics()` cannot see them (§1.1). That forces a two-source design — or a migration
of the persistent workers to `utilityProcess.fork()`, which would unify them under
`getAppMetrics` with a per-worker `serviceName` and `child-process-gone` crash events (§3.3).

**(a) Dev-only harness** — mirror VS Code's process explorer:

- OS process-tree poller at ~1 Hz rooted at our pid (VS Code's `ps.ts` approach, §2.1), giving
  CPU/RSS for *everything* including git grandchildren, only while a dev panel is open.
- `contentTracing` session capture behind a dev command for deep dives (§1.5).
- React DevTools / dev-build `<Profiler>` for render analysis (§4.3).
- Spawn-seam wrapper in verbose mode: log every spawn with argv/duration/exit code (§3.1).

**(b) Optional production telemetry** — all cheap, all behind the existing opt-in, ideally with
VS Code-style session sampling:

- Main process: `app.getAppMetrics()` on a slow interval (Chromium-side footprint) plus
  `monitorEventLoopDelay`/ELU for main-process health (§1.1, §1.7).
- Each worker: self-report `process.memoryUsage.rss()`, `process.cpuUsage(prev)`, ELU,
  event-loop-delay percentiles, and `v8.getHeapStatistics()` (`number_of_detached_contexts` as a
  leak canary) over the existing IPC (§1.3, §1.6, §1.7).
- Spawn-seam counters in main + workers for git subprocess counts/durations — the only reliable
  way to count sub-second spawns (§3.1).
- Renderer: `longtask` + `event`/`first-input` observers, INP via the web-vitals aggregation
  pattern (§4.1, §4.2). Skip the React profiling build in production.
- Escalation path (VS Code pattern, §2.3): keep only the cheap signals always on, and attach a
  bounded V8 CPU profile to a specific worker only when a trigger (e.g. sustained ELU ≈ 1 or
  event-loop delay p99 spike) fires — and even then only with telemetry consent.
