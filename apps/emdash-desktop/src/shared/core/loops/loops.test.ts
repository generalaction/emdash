import { describe, expect, it } from 'vitest';
import { loopConfig } from './loop-config';
import { loopPhaseCriteria } from './loop-phase-criteria';
import {
  isLoopConfig,
  isLoopPhaseCriterion,
  isLoopStatus,
  isPhaseStatus,
  isVerifierId,
} from './loops';

describe('loop versioned schemas', () => {
  it('parses a v1 loop config', () => {
    const result = loopConfig.safeParse({
      version: '1',
      verifiers: ['gh', 'agent-browser'],
      reviewEnabled: true,
      validationCommands: ['pnpm run test'],
      planSource: 'docs/plans/acp-loops.md',
      agentBrowser: {
        targetUrl: 'http://localhost:5173',
        cdpPort: 9222,
      },
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data).toEqual({
        version: '1',
        verifiers: ['gh', 'agent-browser'],
        reviewEnabled: true,
        validationCommands: ['pnpm run test'],
        planSource: 'docs/plans/acp-loops.md',
        agentBrowser: {
          targetUrl: 'http://localhost:5173',
          cdpPort: 9222,
        },
      });
    }
  });

  it('round-trips a v1 loop config through serialize and parseJson', () => {
    const config = loopConfig.safeParse({
      version: '1',
      verifiers: ['vercel', 'convex'],
      reviewEnabled: false,
      validationCommands: ['pnpm run typecheck', 'pnpm run lint'],
      planSource: 'phase plan',
    });

    expect(config.status).toBe('ok');
    if (config.status === 'ok') {
      const json = loopConfig.serialize(config.data);
      expect(loopConfig.parseJson(json)).toEqual(config.data);
    }
  });

  it('rejects invalid verifier ids in loop config', () => {
    const result = loopConfig.safeParse({
      version: '1',
      verifiers: ['unknown'],
      reviewEnabled: false,
      validationCommands: [],
      planSource: 'phase plan',
    });

    expect(result.status).toBe('invalid');
  });

  it('parses v1 loop phase criteria', () => {
    const result = loopPhaseCriteria.safeParse({
      version: '1',
      criteria: [
        {
          description: 'CI is green',
          verifier: 'gh',
          status: 'pending',
        },
        {
          description: 'Preview renders the new page',
          verifier: 'agent-browser',
          status: 'passed',
          evidence: '.emdash-loops-evidence/phase-1.png',
        },
      ],
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.criteria).toHaveLength(2);
      expect(result.data.criteria[1]?.evidence).toBe('.emdash-loops-evidence/phase-1.png');
    }
  });

  it('round-trips v1 loop phase criteria through serialize and parseJson', () => {
    const criteria = loopPhaseCriteria.safeParse({
      version: '1',
      criteria: [
        {
          description: 'Deployment is ready',
          verifier: 'vercel',
          status: 'verifying',
        },
      ],
    });

    expect(criteria.status).toBe('ok');
    if (criteria.status === 'ok') {
      const json = loopPhaseCriteria.serialize(criteria.data);
      expect(loopPhaseCriteria.parseJson(json)).toEqual(criteria.data);
    }
  });

  it('returns null for invalid criteria JSON', () => {
    expect(loopPhaseCriteria.parseJson('not-json')).toBeNull();
  });
});

describe('loop type guards', () => {
  it('identifies loop statuses', () => {
    expect(isLoopStatus('draft')).toBe(true);
    expect(isLoopStatus('running')).toBe(true);
    expect(isLoopStatus('done')).toBe(false);
  });

  it('identifies phase statuses', () => {
    expect(isPhaseStatus('reviewing')).toBe(true);
    expect(isPhaseStatus('completed')).toBe(false);
  });

  it('identifies verifier ids', () => {
    expect(isVerifierId('agent-browser')).toBe(true);
    expect(isVerifierId('unit-tests')).toBe(false);
  });

  it('identifies loop configs', () => {
    expect(
      isLoopConfig({
        version: '1',
        verifiers: ['gh'],
        reviewEnabled: false,
        validationCommands: [],
        planSource: 'phase plan',
      })
    ).toBe(true);
    expect(isLoopConfig({ version: '1', verifiers: ['invalid'] })).toBe(false);
  });

  it('identifies loop phase criteria', () => {
    expect(
      isLoopPhaseCriterion({
        description: 'Convex schema validates',
        verifier: 'convex',
        status: 'passed',
        evidence: 'stdout',
      })
    ).toBe(true);
    expect(isLoopPhaseCriterion({ description: 'Missing verifier', status: 'passed' })).toBe(false);
  });
});
