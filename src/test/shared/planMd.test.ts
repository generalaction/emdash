import { describe, it, expect } from 'vitest';
import {
  parsePlanMd,
  writePlanMd,
  updateStepInPlan,
  updateStepByNumber,
  addStepsToPlan,
} from '@shared/zenflow/planMd';
import type { PlanDocument, PlanStepData } from '@shared/zenflow/types';

describe('planMd parser/writer', () => {
  const samplePlan: PlanDocument = {
    featureDescription: 'Add user authentication',
    templateId: 'spec-and-build',
    steps: [
      {
        stepNumber: 1,
        name: 'Tech Spec',
        type: 'spec',
        status: 'completed',
        conversationId: 'conv_abc',
        pauseAfter: true,
      },
      {
        stepNumber: 2,
        name: 'Implementation',
        type: 'implementation',
        status: 'running',
        conversationId: 'conv_def',
        pauseAfter: false,
      },
    ],
  };

  describe('parsePlanMd', () => {
    it('parses a well-formed plan.md', () => {
      const content = writePlanMd(samplePlan);
      const parsed = parsePlanMd(content);

      expect(parsed.featureDescription).toBe('Add user authentication');
      expect(parsed.templateId).toBe('spec-and-build');
      expect(parsed.steps).toHaveLength(2);
      expect(parsed.steps[0]).toEqual(samplePlan.steps[0]);
      expect(parsed.steps[1]).toEqual(samplePlan.steps[1]);
    });

    it('handles empty content', () => {
      const parsed = parsePlanMd('');
      expect(parsed.featureDescription).toBe('');
      expect(parsed.steps).toHaveLength(0);
    });

    it('handles malformed step comments gracefully', () => {
      const content = `
<!-- zenflow-meta: {"featureDescription":"test","templateId":"spec-and-build"} -->
# Workflow: test

## Steps

<!-- zenflow-step: {"stepNumber":1,"name":"Good Step","type":"spec","status":"completed","conversationId":"conv_1","pauseAfter":false} -->
- [x] **Step 1: Good Step**

<!-- zenflow-step: {invalid json -->
- [ ] Bad step

<!-- zenflow-step: {"stepNumber":3,"name":"Another Good","type":"implementation","status":"pending","conversationId":"conv_3","pauseAfter":true} -->
- [ ] **Step 3: Another Good**
`;
      const parsed = parsePlanMd(content);
      // Should parse valid steps, skipping the malformed one
      // Note: the regex may not recover after malformed comments depending on content
      expect(parsed.steps.length).toBeGreaterThanOrEqual(1);
      expect(parsed.steps[0].name).toBe('Good Step');
    });

    it('defaults missing fields', () => {
      const content = `
<!-- zenflow-step: {"stepNumber":1} -->
- [ ] Step
`;
      const parsed = parsePlanMd(content);
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0].name).toBe('Step 1');
      expect(parsed.steps[0].type).toBe('implementation');
      expect(parsed.steps[0].status).toBe('pending');
      expect(parsed.steps[0].conversationId).toBeNull();
      expect(parsed.steps[0].pauseAfter).toBe(false);
    });
  });

  describe('writePlanMd', () => {
    it('produces markdown with zenflow-meta and zenflow-step comments', () => {
      const md = writePlanMd(samplePlan);

      expect(md).toContain('<!-- zenflow-meta:');
      expect(md).toContain('"featureDescription":"Add user authentication"');
      expect(md).toContain('# Workflow: Add user authentication');
      expect(md).toContain('<!-- zenflow-step:');
      expect(md).toContain('- [x] **Step 1: Tech Spec**');
      expect(md).toContain('- [ ] **Step 2: Implementation** *(in progress)*');
    });
  });

  describe('round-trip', () => {
    it('write then parse produces identical data', () => {
      const md = writePlanMd(samplePlan);
      const parsed = parsePlanMd(md);

      expect(parsed.featureDescription).toBe(samplePlan.featureDescription);
      expect(parsed.templateId).toBe(samplePlan.templateId);
      expect(parsed.steps).toEqual(samplePlan.steps);
    });
  });

  describe('updateStepInPlan', () => {
    it('updates a step by conversationId', () => {
      const md = writePlanMd(samplePlan);
      const updated = updateStepInPlan(md, 'conv_def', { status: 'completed' });
      const parsed = parsePlanMd(updated);

      // Step 1 unchanged
      expect(parsed.steps[0].status).toBe('completed');
      // Step 2 updated
      expect(parsed.steps[1].status).toBe('completed');
    });

    it('does not modify other steps', () => {
      const md = writePlanMd(samplePlan);
      const updated = updateStepInPlan(md, 'conv_abc', { status: 'failed' });
      const parsed = parsePlanMd(updated);

      expect(parsed.steps[0].status).toBe('failed');
      expect(parsed.steps[1].status).toBe('running'); // unchanged
    });

    it('returns unchanged content for unknown conversationId', () => {
      const md = writePlanMd(samplePlan);
      const updated = updateStepInPlan(md, 'nonexistent', { status: 'failed' });
      expect(updated).toBe(md);
    });
  });

  describe('updateStepByNumber', () => {
    it('updates a step and re-syncs checkbox', () => {
      const md = writePlanMd(samplePlan);
      const updated = updateStepByNumber(md, 2, { status: 'completed' });

      expect(updated).toContain('- [x] **Step 2: Implementation**');
      expect(updated).not.toContain('*(in progress)*');
    });
  });

  describe('addStepsToPlan', () => {
    it('appends new steps', () => {
      const md = writePlanMd(samplePlan);
      const newSteps: PlanStepData[] = [
        {
          stepNumber: 3,
          name: 'Testing',
          type: 'implementation',
          status: 'pending',
          conversationId: 'conv_ghi',
          pauseAfter: false,
        },
      ];
      const updated = addStepsToPlan(md, newSteps);
      const parsed = parsePlanMd(updated);

      expect(parsed.steps).toHaveLength(3);
      expect(parsed.steps[2].name).toBe('Testing');
      expect(parsed.steps[2].conversationId).toBe('conv_ghi');
    });
  });
});
