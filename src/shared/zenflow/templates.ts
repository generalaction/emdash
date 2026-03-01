import type { WorkflowStepType, ZenflowTemplateId } from './types';

/** Template definition for a single workflow step */
export interface ZenflowStepTemplate {
  name: string;
  type: WorkflowStepType;
  pauseAfter: boolean;
  promptTemplate: string;
  outputArtifacts: string[]; // file names relative to .zenflow/
  /** If true, this step can dynamically expand into sub-steps (e.g. planning step) */
  isDynamic?: boolean;
}

/** Template definition for a complete workflow */
export interface ZenflowTemplate {
  id: ZenflowTemplateId;
  name: string;
  description: string;
  steps: ZenflowStepTemplate[];
}

export const ZENFLOW_TEMPLATES: ZenflowTemplate[] = [
  {
    id: 'spec-and-build',
    name: 'Spec & Build',
    description: 'Write a tech spec, then implement. Good for medium-complexity tasks.',
    steps: [
      {
        name: 'Tech Spec',
        type: 'spec',
        pauseAfter: true,
        outputArtifacts: ['spec.md'],
        promptTemplate: `You are executing Step 1: Tech Spec of a feature development workflow.

## Feature Request
{{featureDescription}}

## Your Task
Analyze the feature request and produce a technical specification document. Save it to \`{{artifactsDir}}/spec.md\`.

Your spec should include:
1. **Overview** — What this feature does and why
2. **Technical approach** — How to implement it (architecture, data model, key components)
3. **Complexity assessment** — Simple, medium, or complex
4. **Implementation steps** — If complex, break into concrete sub-tasks that can each be done in a single focused session
5. **Edge cases and risks** — What could go wrong

## Rules
- Save your output to \`{{artifactsDir}}/spec.md\`
- Follow existing project conventions
- When done, provide a brief summary of the spec

## Marking this step complete
When you have finished this step, mark it as complete by editing \`{{artifactsDir}}/plan.md\`.
Find the HTML comment \`<!-- zenflow-step: {...} -->\` for **Step {{stepNumber}}** and change \`"status":"running"\` to \`"status":"completed"\`.`,
      },
      {
        name: 'Implementation',
        type: 'implementation',
        pauseAfter: false,
        outputArtifacts: ['report.md'],
        promptTemplate: `You are executing Step 2: Implementation of a feature development workflow.

## Feature Request
{{featureDescription}}

## Context
Read the technical specification at \`{{artifactsDir}}/spec.md\` for the full implementation plan.

## Your Task
Implement the feature as described in the spec. Follow the implementation steps outlined there.

## Rules
- Read \`{{artifactsDir}}/spec.md\` before starting
- Follow existing project conventions
- Write clean, tested code
- When done, write a brief report of what you implemented to \`{{artifactsDir}}/report.md\`

## Marking this step complete
When you have finished this step, mark it as complete by editing \`{{artifactsDir}}/plan.md\`.
Find the HTML comment \`<!-- zenflow-step: {...} -->\` for **Step {{stepNumber}}** and change \`"status":"running"\` to \`"status":"completed"\`.`,
      },
    ],
  },
  {
    id: 'full-sdd',
    name: 'Full SDD',
    description:
      'Requirements, tech spec, planning, then implement. Good for large, complex features.',
    steps: [
      {
        name: 'Requirements',
        type: 'requirements',
        pauseAfter: true,
        outputArtifacts: ['requirements.md'],
        promptTemplate: `You are executing Step 1: Requirements of a feature development workflow.

## Feature Request
{{featureDescription}}

## Your Task
Analyze the feature request and produce a requirements document. You should:
1. Break down the feature into clear, specific requirements
2. Identify any ambiguities or open questions
3. Define acceptance criteria for each requirement
4. Note any dependencies or prerequisites

Ask the user clarifying questions if needed. Save the final requirements to \`{{artifactsDir}}/requirements.md\`.

## Rules
- Save your output to \`{{artifactsDir}}/requirements.md\`
- Ask clarifying questions directly — the user is available in this chat
- When done, provide a brief summary

## Marking this step complete
When you have finished this step, mark it as complete by editing \`{{artifactsDir}}/plan.md\`.
Find the HTML comment \`<!-- zenflow-step: {...} -->\` for **Step {{stepNumber}}** and change \`"status":"running"\` to \`"status":"completed"\`.`,
      },
      {
        name: 'Tech Spec',
        type: 'spec',
        pauseAfter: false,
        outputArtifacts: ['spec.md'],
        promptTemplate: `You are executing Step 2: Tech Spec of a feature development workflow.

## Feature Request
{{featureDescription}}

## Context
Read the requirements document at \`{{artifactsDir}}/requirements.md\`.

## Your Task
Based on the requirements, produce a technical specification that covers:
1. **Architecture** — Components, data flow, integrations
2. **Data model** — Schema changes, new entities
3. **API design** — Endpoints, interfaces, contracts
4. **Implementation approach** — Key algorithms, patterns to use
5. **Testing strategy** — What to test and how

Save to \`{{artifactsDir}}/spec.md\`.

## Rules
- Read \`{{artifactsDir}}/requirements.md\` before starting
- Save your output to \`{{artifactsDir}}/spec.md\`
- Follow existing project conventions
- When done, provide a brief summary

## Marking this step complete
When you have finished this step, mark it as complete by editing \`{{artifactsDir}}/plan.md\`.
Find the HTML comment \`<!-- zenflow-step: {...} -->\` for **Step {{stepNumber}}** and change \`"status":"running"\` to \`"status":"completed"\`.`,
      },
      {
        name: 'Planning',
        type: 'planning',
        pauseAfter: true,
        outputArtifacts: ['plan-details.md'],
        isDynamic: true,
        promptTemplate: `You are executing Step 3: Planning of a feature development workflow.

## Feature Request
{{featureDescription}}

## Context
Read these artifacts for full context:
- Requirements: \`{{artifactsDir}}/requirements.md\`
- Tech Spec: \`{{artifactsDir}}/spec.md\`

## Your Task
Create a detailed implementation plan that breaks the work into concrete, focused sub-tasks. Each sub-task should be a coherent unit of work that one coding session can handle well.

Format your plan in \`{{artifactsDir}}/plan-details.md\` with this structure:

\`\`\`markdown
# Implementation Plan

## Step 4: [Name]
[Clear instructions for what to implement in this step]

## Step 5: [Name]
[Clear instructions for what to implement in this step]

## Step 6: [Name]
...
\`\`\`

Each step should:
- Have a clear, descriptive name
- Include specific files to create or modify
- Be independent enough to work in isolation with artifact context
- Build on previous steps' work

## Rules
- Read requirements.md and spec.md before starting
- Save your output to \`{{artifactsDir}}/plan-details.md\`
- Number steps starting from 4 (Steps 1-3 are requirements, spec, and planning)
- When done, provide a brief summary of the plan

## Marking this step complete
When you have finished this step, mark it as complete by editing \`{{artifactsDir}}/plan.md\`.
Find the HTML comment \`<!-- zenflow-step: {...} -->\` for **Step {{stepNumber}}** and change \`"status":"running"\` to \`"status":"completed"\`.`,
      },
      // Implementation steps are added dynamically after the planning step completes
    ],
  },
];

/** Look up a template by ID */
export function getZenflowTemplate(id: ZenflowTemplateId): ZenflowTemplate | undefined {
  return ZENFLOW_TEMPLATES.find((t) => t.id === id);
}
