import { describe, expect, it } from 'vitest';
import { conversationsHostStylesContribution } from './host-styles';

describe('conversations Host Styling Adapter contribution', () => {
  it('owns the Chat UI adapter at the feature seam', () => {
    expect(conversationsHostStylesContribution.id).toBe('chat-ui-theme');
    expect(conversationsHostStylesContribution.exports.chatHostAdapterClassName).not.toBe('');
  });
});
