# Handoff: Implement Zenflow-Style Workflow in Emdash

## What is Zenflow?

Zenflow (from Zencoder) is a task orchestration system for AI-assisted development. It breaks large features into a chain of steps, where each step runs in its own isolated chat/context. A `plan.md` file acts as the control panel, tracking progress and linking to each step's chat.

The key insight: large features fail when attempted in a single AI chat (context overflow, loss of focus). Zenflow solves this by decomposing work into a chain of focused, isolated tasks that pass context through artifact files rather than conversation history.

## Two Workflow Templates

### Spec & Build (simpler)
```
Step 1: Tech Spec → [PAUSE for review] → Step 2+: Implementation (auto-chain)
```
- Step 1 assesses difficulty, writes a spec, and if complex, breaks implementation into sub-steps
- Implementation steps auto-continue without user intervention
- Good for medium-complexity tasks

### Full SDD (comprehensive)
```
Step 1: Requirements → [PAUSE] → Step 2: Tech Spec → Step 3: Planning → [PAUSE] → Step 4+: Implementation (auto-chain)
```
- Step 1 creates a PRD (Product Requirements Document), asks user clarifying questions
- Step 2 creates technical specification
- Step 3 is the critical step: it dynamically expands the plan by adding concrete implementation sub-steps (Step 4, 5, 6, etc.)
- After user reviews the expanded plan, implementation steps auto-chain
- Good for large, complex features

## Core UX Concepts to Implement

### 1. Plan as Control Panel
A `plan.md` file per task, stored at `.zenflow/tasks/{task_id}/plan.md`. Contains:
- Feature description
- Ordered list of steps with checkbox status: `[ ]` pending, `[x]` done, `[!]` blocked
- Each step has instructions for the agent
- Each step has a link/reference to its chat session

The user can view this at any time to see overall progress.

### 2. Isolated Step Chats
**This is the most important feature.** Each step runs in its own chat/session:
- Fresh context window (no pollution from other steps)
- The step's chat persists and can be revisited anytime
- When revisiting, the full conversation history is preserved
- User can continue chatting interactively in a revisited step (ask for changes, reviews, etc.)

Context passes between steps via **artifact files**, not conversation history:
- `requirements.md` (from Requirements step)
- `spec.md` (from Tech Spec step)
- `plan.md` (from Planning step)
- Code changes (committed or staged)
- `report.md` (from Implementation steps)

### 3. Flow Control
- **Pause points**: After Requirements, after Planning - these are decision gates where the user should review before proceeding
- **Auto-continue**: Implementation steps chain automatically - no user intervention needed between them
- **User override**: User can say "pause" to stop auto-chaining, or "auto" to resume it
- **Revisit**: User can open any completed step's chat and continue the conversation

### 4. Dynamic Plan Expansion
The Planning step (Step 3 in SDD) reads the spec and dynamically adds implementation sub-steps to `plan.md`. For example, a "user authentication" feature might expand into:
- Step 4: Implement user model and database schema
- Step 5: Add login/signup API endpoints
- Step 6: Create auth middleware
- Step 7: Build login UI components
- Step 8: Add session management
- Step 9: Integration tests

Each sub-step is a coherent unit of work that one chat session can handle well.

### 5. Review Capability
At any point, the user can ask for a review of a step's work. Ideally this:
- Opens the step's chat in a "reviewer" persona
- The reviewer has full context of what was done and why
- Returns a verdict: APPROVE, REQUEST_CHANGES, NEEDS_DISCUSSION

## Implementation in Emdash (Option C: Separate Sessions)

The idea is to build this as a first-class emdash feature where each step is a **separate Claude Code CLI session** managed by emdash.

### Architecture

```
┌─────────────────────────────────────────┐
│  Emdash UI (Plan View)                  │
│                                         │
│  Feature: Add user auth                 │
│  ┌─────────────────────────────────┐    │
│  │ [x] Step 1: Requirements    [→] │    │  ← click [→] to open step's chat
│  │ [x] Step 2: Tech Spec      [→] │    │
│  │ [x] Step 3: Planning       [→] │    │
│  │ [▶] Step 4: User model     [→] │    │  ← currently running
│  │ [ ] Step 5: API endpoints  [ ] │    │
│  │ [ ] Step 6: Auth middleware [ ] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [Next] [Auto-run All] [Pause] [Review] │
└─────────────────────────────────────────┘
          │
          │ manages
          ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Claude Code  │  │ Claude Code  │  │ Claude Code  │
│ Session 1    │  │ Session 2    │  │ Session 4    │
│ (Requirements)│ │ (Tech Spec)  │  │ (User model) │
│              │  │              │  │              │
│ Full chat    │  │ Full chat    │  │ Full chat    │
│ history      │  │ history      │  │ history      │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Key Components to Build

#### 1. Task/Workflow Data Model
```
Task {
  id: string (kebab-case)
  title: string
  description: string
  status: 'planning' | 'in-progress' | 'completed' | 'paused'
  workflow_type: 'sdd' | 'spec-and-build'
  artifacts_path: string
  steps: Step[]
  created_at: date
}

Step {
  number: number
  title: string
  instructions: string (markdown)
  status: 'pending' | 'in-progress' | 'completed' | 'blocked'
  session_id: string | null  // reference to Claude Code session
  is_pause_point: boolean
  artifacts: string[]  // files this step produced
}
```

#### 2. Session Manager
Manages Claude Code CLI sessions for each step:
- **Start session**: Launch `claude` CLI in a terminal/pane with the step's prompt pre-loaded
  - The prompt includes: step instructions, feature context, artifacts path, instruction to read prior artifacts
- **Open session**: Re-open/attach to an existing session (if Claude Code supports session resume via `--resume` flag or session ID)
- **Monitor session**: Watch for session completion (exit code, or sentinel file written by the agent)
- **Chain sessions**: When a step completes and it's not a pause point, automatically start the next step's session

#### 3. Plan File Manager
Reads and writes `.zenflow/tasks/{task_id}/plan.md`:
- Parse step statuses from checkbox markdown
- Update checkboxes when steps complete
- Detect when Planning step adds new steps (file watcher or re-parse after step 3)
- Sync plan state with the UI

#### 4. Artifact Manager
Manages the `.zenflow/tasks/{task_id}/` directory:
- List available artifacts for a step (so the step's prompt can reference them)
- Watch for new artifacts being created
- Display artifact contents in the UI if needed

#### 5. UI Components
- **Workflow Launcher**: Form to start a new SDD or Spec & Build workflow (input: feature description)
- **Plan View**: Shows the step list with statuses, click-to-open step chats
- **Step Chat View**: Embedded terminal/pane showing the Claude Code session for a step
- **Controls**: Next, Auto-run, Pause, Review buttons
- **Artifact Viewer**: Optional panel showing spec.md, requirements.md, etc.

### How Each Step Session Works

When starting a step, emdash launches a Claude Code session with a carefully constructed initial prompt:

```
You are executing Step {N}: {title} of a feature development workflow.

Feature: {original description}
Artifacts directory: {path}

## Your Instructions
{step instructions from plan.md}

## Prior Artifacts
Read the following files for context before starting:
- {list of files in artifacts directory}

## Rules
- Save your outputs to the artifacts directory
- Follow project conventions (read .claude/rules/ if present)
- If you need user clarification, ask directly
- When done, write a brief summary of what you accomplished
```

### Claude Code CLI Integration Points

Emdash needs to interact with the `claude` CLI. Key integration:

1. **Starting a session**: `claude` (interactive mode in a managed terminal pane)
2. **Resuming a session**: `claude --resume` or `claude --continue` (check Claude Code docs for exact flag)
3. **Non-interactive execution**: `claude -p "prompt"` for auto-run steps where no user interaction is expected
4. **Session persistence**: Claude Code stores session transcripts - emdash needs to know where and how to reference them

### Flow Implementation

```
User clicks "Start SDD Workflow" with feature description
  → Emdash creates task, generates plan.md
  → Emdash starts Step 1 session (interactive, in visible pane)
  → User chats with Step 1 agent about requirements
  → Step 1 completes (agent writes requirements.md, user says "done" or session ends)
  → Emdash detects completion, updates plan.md [x]
  → PAUSE: Emdash shows "Requirements complete. Review and continue?"

User clicks "Next"
  → Emdash starts Step 2 session (can be auto/background since tech spec is less interactive)
  → Step 2 completes, writes spec.md
  → Auto-continue to Step 3

Step 3 (Planning) runs
  → Agent reads spec.md, edits plan.md to add Steps 4-8
  → Emdash detects plan.md change, re-parses, updates UI
  → PAUSE: "Plan expanded to 8 steps. Review and start building?"

User clicks "Auto-run All"
  → Emdash sequentially launches Steps 4, 5, 6, 7, 8
  → Each as a separate Claude Code session
  → Each reads prior artifacts + makes code changes
  → Brief status shown in UI as each completes
  → User can click into any running/completed step to see/continue the chat

All steps done
  → Emdash marks task as completed
  → Shows summary of all changes made
```

## Reference Files

- `plan-sdd.md` - Original Zenflow SDD template (from Zencoder's app)
- `plan-spec-n-build.md` - Original Zenflow Spec & Build template
- `.agent/commands/*.md` - Claude Code slash command implementations (working prototype using Task subagents)

## Key Tradeoffs and Decisions

1. **Session management**: The hardest part. Need to figure out how Claude Code CLI handles session persistence and resume. If it doesn't support true resume, each "revisit" would be a new session pre-loaded with artifacts (still useful, just not a true chat continuation).

2. **Step completion detection**: How does emdash know a step is done? Options:
   - Watch for a sentinel file (e.g., step writes `step-N-complete.json`)
   - Monitor CLI exit
   - Parse plan.md for checkbox changes
   - User manually marks it done in the UI

3. **Interactive vs non-interactive**: Requirements and Planning steps benefit from interactive chat. Implementation steps could run non-interactively (`claude -p`) for faster execution. Emdash could let the user choose per-step.

4. **Concurrency**: Could multiple implementation steps run in parallel? Risky (merge conflicts) but possible for independent steps. Start with sequential, add parallel as an advanced option.
