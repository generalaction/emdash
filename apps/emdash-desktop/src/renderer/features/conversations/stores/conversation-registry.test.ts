import { describe, expect, it, vi } from 'vitest';
import { ConversationRegistry } from './conversation-registry';

vi.mock('@renderer/features/conversations/conversation-manager', () => ({
  ConversationManagerStore: class {
    dispose() {}
  },
}));

describe('ConversationRegistry', () => {
  it('keeps stores for the same task id in different projects independent', () => {
    const registry = new ConversationRegistry();
    const first = registry.acquire('project-1', 'shared-task', []);
    const second = registry.acquire('project-2', 'shared-task', []);

    expect(second).not.toBe(first);
    expect(registry.get('project-1', 'shared-task')).toBe(first);
    expect(registry.get('project-2', 'shared-task')).toBe(second);

    registry.release('project-1', 'shared-task');
    expect(registry.get('project-2', 'shared-task')).toBe(second);
    registry.release('project-2', 'shared-task');
  });

  it('does not collide when ids contain delimiters', () => {
    const registry = new ConversationRegistry();
    const first = registry.acquire('project:one', 'task', []);
    const second = registry.acquire('project', 'one:task', []);

    expect(second).not.toBe(first);
    expect(registry.get('project:one', 'task')).toBe(first);
    expect(registry.get('project', 'one:task')).toBe(second);
  });
});
