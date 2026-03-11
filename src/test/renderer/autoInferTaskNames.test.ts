import { describe, expect, it } from 'vitest';
import {
  generateTaskName,
  generateTaskNameFromContext,
} from '../../renderer/lib/branchNameGenerator';
import { generateFriendlyTaskName } from '../../renderer/lib/taskNames';

describe('autoInferTaskNames toggle logic', () => {
  describe('when autoInferTaskNames is OFF (default)', () => {
    it('random name generator produces a valid name', () => {
      const name = generateFriendlyTaskName([]);
      expect(name).toBeTruthy();
      expect(name).toMatch(/^[a-z0-9-]+$/);
    });

    it('random name generator avoids collisions with existing names', () => {
      const existing = [generateFriendlyTaskName([])];
      const second = generateFriendlyTaskName(existing);
      expect(second).toBeTruthy();
      expect(existing).not.toContain(second);
    });

    it('nameGenerated should be false so post-creation rename is skipped', () => {
      // When autoInferTaskNames is false, isNameGenerated should be set to false.
      // This simulates the TaskModal submit logic.
      const autoGenerateName = true;
      const autoInferTaskNames = false;
      const userHasTyped = false;
      const nameFromContext = false;

      let isNameGenerated = false;
      const finalName = '';
      if (!finalName) {
        // Random fallback
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      } else if (!userHasTyped && !nameFromContext) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      }

      expect(isNameGenerated).toBe(false);
    });
  });

  describe('when autoInferTaskNames is ON', () => {
    it('context-based inference returns a slug from a prompt', () => {
      const result = generateTaskNameFromContext({
        initialPrompt: 'Fix the broken authentication on the login page',
      });
      expect(result).toBeTruthy();
      expect(result).toMatch(/^[a-z0-9-]+$/);
    });

    it('context-based inference returns null for short/empty prompts', () => {
      expect(generateTaskNameFromContext({})).toBeNull();
      expect(generateTaskNameFromContext({ initialPrompt: 'hi' })).toBeNull();
    });

    it('post-creation rename generates a name from terminal message', () => {
      const message = 'I will refactor the payment processing module to use Stripe webhooks';
      const generated = generateTaskName(message);
      expect(generated).toBeTruthy();
      expect(generated).toMatch(/^[a-z0-9-]+$/);
    });

    it('nameGenerated should be true so post-creation rename is allowed', () => {
      // When both autoGenerateName and autoInferTaskNames are true,
      // isNameGenerated should be true for random fallback names.
      const autoGenerateName = true;
      const autoInferTaskNames = true;
      const userHasTyped = false;
      const nameFromContext = false;

      let isNameGenerated = false;
      const finalName = '';
      if (!finalName) {
        // Random fallback
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      } else if (!userHasTyped && !nameFromContext) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      }

      expect(isNameGenerated).toBe(true);
    });

    it('nameGenerated should be false when user typed a custom name', () => {
      const autoGenerateName = true;
      const autoInferTaskNames = true;
      const userHasTyped = true;
      const nameFromContext = false;
      const finalName = 'my-custom-task';

      let isNameGenerated = false;
      if (!finalName) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      } else if (!userHasTyped && !nameFromContext) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      }

      expect(isNameGenerated).toBe(false);
    });

    it('nameGenerated should be false when name was derived from context', () => {
      const autoGenerateName = true;
      const autoInferTaskNames = true;
      const userHasTyped = false;
      const nameFromContext = true;
      const finalName = 'fix-login-redirect';

      let isNameGenerated = false;
      if (!finalName) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      } else if (!userHasTyped && !nameFromContext) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      }

      expect(isNameGenerated).toBe(false);
    });
  });

  describe('when autoGenerateName is OFF but autoInferTaskNames is ON', () => {
    it('nameGenerated should be false — autoGenerateName gates the flag', () => {
      const autoGenerateName = false;
      const autoInferTaskNames = true;
      const userHasTyped = false;
      const nameFromContext = false;

      let isNameGenerated = false;
      const finalName = '';
      if (!finalName) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      } else if (!userHasTyped && !nameFromContext) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      }

      expect(isNameGenerated).toBe(false);
    });

    it('nameGenerated stays false even for a non-empty random fallback name', () => {
      const autoGenerateName = false;
      const autoInferTaskNames = true;
      const userHasTyped = false;
      const nameFromContext = false;
      const finalName = 'some-random-name';

      let isNameGenerated = false;
      if (!finalName) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      } else if (!userHasTyped && !nameFromContext) {
        isNameGenerated = autoGenerateName && autoInferTaskNames;
      }

      expect(isNameGenerated).toBe(false);
    });
  });

  describe('shouldCaptureFirstMessage gating', () => {
    interface CaptureTestCase {
      autoInferTaskNames: boolean;
      nameGenerated: boolean;
      multiAgent: boolean;
      hasProject: boolean;
      hasOnRename: boolean;
      expected: boolean;
    }

    const cases: CaptureTestCase[] = [
      {
        autoInferTaskNames: false,
        nameGenerated: true,
        multiAgent: false,
        hasProject: true,
        hasOnRename: true,
        expected: false,
      },
      {
        autoInferTaskNames: true,
        nameGenerated: true,
        multiAgent: false,
        hasProject: true,
        hasOnRename: true,
        expected: true,
      },
      {
        autoInferTaskNames: true,
        nameGenerated: false,
        multiAgent: false,
        hasProject: true,
        hasOnRename: true,
        expected: false,
      },
      {
        autoInferTaskNames: true,
        nameGenerated: true,
        multiAgent: true,
        hasProject: true,
        hasOnRename: true,
        expected: false,
      },
      {
        autoInferTaskNames: true,
        nameGenerated: true,
        multiAgent: false,
        hasProject: false,
        hasOnRename: true,
        expected: false,
      },
    ];

    cases.forEach(
      ({ autoInferTaskNames, nameGenerated, multiAgent, hasProject, hasOnRename, expected }, i) => {
        it(`case ${i + 1}: shouldCaptureFirstMessage = ${expected}`, () => {
          const result = !!(
            autoInferTaskNames &&
            nameGenerated &&
            !multiAgent &&
            hasProject &&
            hasOnRename
          );
          expect(result).toBe(expected);
        });
      }
    );
  });
});
