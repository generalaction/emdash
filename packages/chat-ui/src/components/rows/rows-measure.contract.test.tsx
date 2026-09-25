/**
 * Measurement contracts for previously uncovered row kinds (plan ticket 14):
 * message, diff, plan, subagent, working.
 *
 * Each case mounts the real UnitDef.Render in a fixed-width container and
 * asserts def.measure(data, ctx) === element.offsetHeight (exact integer px).
 * Pragmatic coverage: representative fixtures per kind, not exhaustive.
 *
 * Run:
 *   pnpm exec vitest run --project browser src/components/rows/rows-measure.contract.test.tsx
 */

import { describe, expect, it } from 'vitest';
import type { ChatDiff, ChatMessage, ChatPlan, ChatSubagentToolCall, WorkingItem } from '@/model';
import { makeContractCtx, renderAndMeasureUnit } from '@/tests/contract';
import { messageUnitDef } from './message/message.def';
import { planUnitDef } from './plan/plan.def';
import { diffUnitDef } from './tools/diff/diff.def';
import { subagentUnitDef } from './tools/subagent/subagent.def';
import { workingUnitDef } from './working/working.def';

// Defs are typed per-kind; the harness is generic, so widen at this boundary.
// oxlint doesn't flag `any` in test files, hence no disable directive here.
const asDef = (def: unknown) => def as any;

describe('row measurement contracts', () => {
  describe('message', () => {
    it('assistant markdown (prose + code fence + list)', async () => {
      const item: ChatMessage = {
        kind: 'message',
        id: 'm-1',
        role: 'assistant',
        text: [
          'Intro paragraph that is long enough to wrap across more than a single line at the test width, verifying prose shaping.',
          '',
          '```ts',
          'const a = 1;',
          'const b = compute(a);',
          '```',
          '',
          '- first bullet',
          '- second bullet',
        ].join('\n'),
      };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(messageUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });

    it('user message card', async () => {
      const item: ChatMessage = {
        kind: 'message',
        id: 'm-2',
        role: 'user',
        text: 'Please fix the flaky test in the scheduler and explain what caused it.',
      };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(messageUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });
  });

  describe('diff', () => {
    it('modified file with preview rows', async () => {
      const oldText = Array.from({ length: 6 }, (_, i) => `line ${i};`).join('\n');
      const newText = oldText.replace('line 3;', 'line three;');
      const item: ChatDiff = {
        kind: 'diff',
        id: 'tc-1:src/a.ts',
        path: 'src/a.ts',
        oldText,
        newText,
        status: 'done',
      };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(diffUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });

    it('new file (no oldText)', async () => {
      const item: ChatDiff = {
        kind: 'diff',
        id: 'tc-2:src/new.ts',
        path: 'src/new.ts',
        oldText: null,
        newText: 'export const created = true;\nexport const twice = 2;',
        status: 'done',
      };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(diffUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });

    it('running with empty content renders header only', async () => {
      const item: ChatDiff = {
        kind: 'diff',
        id: 'tc-3:src/pending.ts',
        path: 'src/pending.ts',
        oldText: null,
        newText: '',
        status: 'running',
      };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(diffUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });
  });

  describe('plan', () => {
    const plan: ChatPlan = {
      kind: 'plan',
      id: 'plan-1',
      entries: [
        {
          content: 'Investigate the failing scheduler test',
          status: 'completed',
          priority: 'high',
        },
        {
          content: 'Fix the race in the frame budget accounting',
          status: 'in_progress',
          priority: 'high',
        },
        { content: 'Add a regression test', status: 'pending', priority: 'medium' },
      ],
    };

    it('collapsed (preview window)', async () => {
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(planUnitDef), plan, ctx);
      expect(computed).toBe(dom);
    });

    it('expanded (full entry list)', async () => {
      // Inverted semantics: isCollapsed(id)=true means expanded for plan.
      const ctx = makeContractCtx({ width: 640, isCollapsed: (id) => id === 'plan-1' });
      const { computed, dom } = await renderAndMeasureUnit(asDef(planUnitDef), plan, ctx);
      expect(computed).toBe(dom);
    });
  });

  describe('subagent', () => {
    it('running subagent header', async () => {
      const item: ChatSubagentToolCall = {
        kind: 'subagent',
        id: 'sa-1',
        name: 'Explore codebase',
        status: 'running',
        phase: 'running',
        agentId: 'agent-7',
      };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(subagentUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });
  });

  describe('working', () => {
    it('fixed-height working row', async () => {
      const item: WorkingItem = { kind: 'working', id: 'w-1' };
      const ctx = makeContractCtx({ width: 640 });
      const { computed, dom } = await renderAndMeasureUnit(asDef(workingUnitDef), item, ctx);
      expect(computed).toBe(dom);
    });
  });
});
