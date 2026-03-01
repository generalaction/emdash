# Handoff: Zenflow Workflow Orchestration for Emdash

## Summary

Implemented a step-by-step workflow orchestration system ("Zenflow") for the Emdash Electron app. Large features are decomposed into a chain of focused, isolated steps — each running in its own Claude Code CLI session. A `plan.md` file tracks progress. Steps auto-chain with pause points for user review between phases.

**Total: ~1,608 lines of new code across 10 new files + ~508 lines of changes across 12 modified files.**

---

## What Was Built

### Two Workflow Templates

1. **Spec & Build** (`spec-and-build`) — 2 steps: Tech Spec → Implementation. Good for medium tasks.
2. **Full SDD** (`full-sdd`) — 3 steps: Requirements → Tech Spec → Planning. Good for complex features. (Planning step is marked `isDynamic` — it can expand into implementation sub-steps.)

### Core Architecture

- **Step = Conversation**: Each workflow step maps to an emdash conversation (reuses the existing multi-chat system).
- **Completion detection**: PTY exit event — when the Claude CLI process exits, the step is considered done.
- **Orchestration in main process**: `ZenflowOrchestrationService` listens for PTY exits and auto-chains to the next step.
- **Artifacts**: Stored in `{worktree}/.zenflow/` — `plan.md`, `requirements.md`, `spec.md`, `report-stepN.md`.
- **Pause points**: Steps with `pauseAfter: 1` trigger a pause, requiring the user to click "Continue" before the next step starts.

---

## New Files Created (10)

### Shared Types & Templates
| File | Lines | Purpose |
|------|-------|---------|
| `src/shared/zenflow/types.ts` | 56 | `WorkflowStep`, `ZenflowMetadata`, `ZenflowEvent` interfaces; `WorkflowStepType`, `WorkflowStepStatus`, `ZenflowTemplateId` type unions |
| `src/shared/zenflow/templates.ts` | 190 | Template definitions with step lists and prompt templates. Each step has `promptTemplate` with `{{featureDescription}}` and `{{artifactsDir}}` placeholders. `getZenflowTemplate()` lookup function. |

### Backend Services
| File | Lines | Purpose |
|------|-------|---------|
| `src/main/services/ZenflowOrchestrationService.ts` | 385 | Core orchestration engine (singleton, extends EventEmitter). Methods: `createWorkflow`, `handlePtyExit`, `startStep`, `startNextStep`, `pauseWorkflow`, `resumeWorkflow`, `retryStep`, `expandSteps`, `registerPtyStep`, `linkConversation`. Manages PTY→step mapping, plan.md generation/updates, broadcasts events to renderer via `BrowserWindow.getAllWindows()`. |
| `src/main/ipc/zenflowIpc.ts` | 116 | IPC handlers: `zenflow:createWorkflow`, `zenflow:getSteps`, `zenflow:resumeWorkflow`, `zenflow:pauseWorkflow`, `zenflow:retryStep`, `zenflow:expandSteps`, `zenflow:startStep`, `zenflow:registerPtyStep`, `zenflow:linkConversation` |

### UI Components
| File | Lines | Purpose |
|------|-------|---------|
| `src/renderer/components/ZenflowTask.tsx` | 232 | Main task component (replaces `MultiAgentTask` for zenflow tasks). Split layout: step navigator sidebar + terminal pane. Auto-starts first step, registers PTY→step mapping. |
| `src/renderer/components/zenflow/StepNavigator.tsx` | 61 | Vertical step list with status icons (CheckCircle2, Circle, Loader2, AlertCircle, PauseCircle). Visual "review" pause-point markers between steps. |
| `src/renderer/components/zenflow/PauseOverlay.tsx` | 89 | Overlay shown when workflow is paused, failed, or completed. "Continue" button for paused, "Retry" button for failed. |
| `src/renderer/hooks/useZenflowWorkflow.ts` | 143 | Custom hook managing workflow state, IPC event subscription, and actions. Returns: `steps`, `activeStepId`, `workflowStatus`, `loading`, `resume`, `pause`, `retryStep`, `switchToStep`, `startStep`, `refreshSteps`. |

### Database Migration
| File | Lines | Purpose |
|------|-------|---------|
| `drizzle/0010_add_workflow_steps.sql` | 23 | Creates `workflow_steps` table with foreign keys and indexes |

### Tests
| File | Lines | Purpose |
|------|-------|---------|
| `src/test/main/ZenflowOrchestrationService.test.ts` | 313 | 12 tests covering: workflow creation (both templates, plan.md, prompt templates, unknown template error), PTY exit handling (non-zenflow PTY, completion, pause points, failure, workflow completion), dynamic step expansion, PTY mapping cleanup |

---

## Files Modified (12)

### Database & Schema
| File | What Changed |
|------|-------------|
| `src/main/db/schema.ts` | Added `workflowSteps` table (id, taskId, conversationId, stepNumber, name, type, status, pauseAfter, prompt, artifactPaths, metadata, startedAt, completedAt, createdAt, updatedAt). Added `workflowStepsRelations` and type exports (`WorkflowStepRow`, `WorkflowStepInsert`). Added workflowSteps to `tasksRelations`. |
| `drizzle/meta/_journal.json` | Added entry for migration `0010_add_workflow_steps` at idx 10 |

### Backend Services
| File | What Changed |
|------|-------------|
| `src/main/services/DatabaseService.ts` | Added `getTask(taskId)` method (didn't exist before). Added workflow step CRUD: `getWorkflowSteps`, `getWorkflowStep`, `saveWorkflowStep`, `updateWorkflowStepStatus`, `insertWorkflowSteps`, `deleteWorkflowStepsAfter`. |
| `src/main/services/ptyIpc.ts` | Added `zenflowOrchestrationService.handlePtyExit(id, exitCode ?? -1)` at 2 PTY exit sites (pty:start handler and pty:startDirect handler) |
| `src/main/ipc/index.ts` | Added import and registration of `registerZenflowIpc` |
| `src/main/preload.ts` | Added zenflow IPC bridge methods in `contextBridge.exposeInMainWorld`. Added zenflow type declarations in `ElectronAPI` interface. Added `onZenflowEvent` listener pattern. |

### Renderer Types
| File | What Changed |
|------|-------------|
| `src/renderer/types/chat.ts` | Added `zenflow` field to `TaskMetadata` interface with: `enabled`, `template`, `currentStepNumber`, `totalSteps`, `status`, `featureDescription`, `artifactsDir` |
| `src/renderer/types/electron-api.d.ts` | Added zenflow method type declarations to **both** the `Window.electronAPI` interface and the `export interface ElectronAPI` (~88 lines total) |

### UI Components
| File | What Changed |
|------|-------------|
| `src/renderer/components/MainContentArea.tsx` | Added ZenflowTask import. Added zenflow routing check before multiAgent check: `(activeTask.metadata as any)?.zenflow?.enabled ? <ZenflowTask ...>` |
| `src/renderer/components/TaskModal.tsx` | Added zenflow state (`zenflowEnabled`, `zenflowTemplate`, `zenflowDescription`). Added UI: checkbox toggle, template selector buttons (Spec & Build / Full SDD), feature description textarea. Modified `onCreateTask` callback signature and `handleSubmit` to pass zenflow config. (~96 lines added) |
| `src/renderer/App.tsx` | Updated `handleCreateTask` to accept and pass through `zenflow` parameter |
| `src/renderer/lib/taskCreationService.ts` | Added `zenflow` field to `CreateTaskParams`. After task creation, if zenflow enabled: calls `zenflowCreateWorkflow`, updates task metadata with zenflow config. (~67 lines added) |

---

## Data Flow

```
TaskModal (user enables zenflow, picks template, enters description)
  → App.handleCreateTask (passes zenflow config)
    → taskCreationService.createTask (creates task, then calls zenflowCreateWorkflow IPC)
      → ZenflowOrchestrationService.createWorkflow (creates step records in DB, creates .zenflow/plan.md)
        → UI renders ZenflowTask component (detects zenflow metadata on task)
          → useZenflowWorkflow hook (loads steps, subscribes to events)
            → Auto-starts first step → TerminalPane spawns PTY
              → PTY exits → ptyIpc calls handlePtyExit
                → ZenflowOrchestrationService marks step complete
                  → If pauseAfter: emits 'workflow-paused' → PauseOverlay shown
                  → If no pause: auto-starts next step
                  → If last step: emits 'workflow-completed'
```

---

## Key Design Decisions

1. **PTY exit as completion signal** — No polling or heartbeats. When the Claude CLI process exits with code 0, the step is done.
2. **Main process orchestration** — All state management in `ZenflowOrchestrationService` (main process). Renderer is a passive event subscriber.
3. **Reuses multi-chat system** — Each step creates a conversation record, reusing the existing conversation infrastructure.
4. **Event broadcasting** — Uses `BrowserWindow.getAllWindows()` to broadcast zenflow events to all renderer windows via `webContents.send`.
5. **PTY-to-step mapping** — A `Map<string, { taskId, stepId }>` in the orchestration service tracks which PTY belongs to which step. Cleaned up after exit.

---

## Testing

All 12 new tests pass. Full test suite: 283 tests across 29 files.

Test coverage areas:
- `createWorkflow`: Both templates produce correct steps, `.zenflow/plan.md` created with correct content, prompt templates resolve placeholders, unknown template throws
- `handlePtyExit`: Ignores non-zenflow PTYs, marks step completed on exit 0, emits `workflow-paused` when `pauseAfter` is set, marks step failed on non-zero exit, emits `workflow-completed` when last step finishes
- `expandSteps`: Adds implementation steps after existing ones with correct numbering
- `registerPtyStep`: PTY mapping cleared after exit (second exit is no-op)

---

## Quality Checks Passed

- `pnpm run format` — Clean
- `pnpm run lint` — 0 errors (965 pre-existing warnings)
- `pnpm run type-check` — Clean
- `pnpm exec vitest run` — 283/283 tests passing

---

## Known Limitations / Future Work

1. **Dynamic expansion not fully wired** — The `expandSteps` method exists and is tested, but there's no automatic parsing of planning step output to generate implementation sub-steps. This needs a post-step hook that reads the planning output and calls `expandSteps`.
2. **App restart recovery** — If the app restarts while a workflow is running, the PTY-to-step mapping is lost. Need to detect in-progress workflows on startup and offer resume.
3. **No step editing** — Users can't edit step prompts or reorder steps after creation.
4. **Migration written manually** — `drizzle-kit generate` had snapshot format issues, so `drizzle/0010_add_workflow_steps.sql` was written by hand. The drizzle snapshot files were not updated, which means the next `drizzle-kit generate` may need attention.
5. **Implementation steps not in templates** — The `full-sdd` template has Requirements → Tech Spec → Planning but no Implementation step. Implementation steps are expected to be added dynamically by `expandSteps` after the Planning step completes.
