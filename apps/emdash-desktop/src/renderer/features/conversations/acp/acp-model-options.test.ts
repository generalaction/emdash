import { describe, expect, it } from 'vitest';
import { mergeComposerModelOptions } from './acp-model-options';

describe('mergeComposerModelOptions', () => {
  it.each([
    ['opus[1m]', 'claude-opus-4-8', 'Claude Opus 4.8', 3, 5],
    ['claude-fable-5[1m]', 'claude-fable-5', 'Claude Fable 5', 3, 5],
    ['sonnet', 'claude-sonnet-5', 'Claude Sonnet 5', 4, 4],
    ['haiku', 'claude-haiku-4-5', 'Claude Haiku 4.5', 5, 3],
  ])(
    'resolves ACP model alias %s to the New Task catalog details',
    (runtimeId, catalogId, name, speed, intelligence) => {
      const description = `Canonical description for ${name}.`;
      expect(
        mergeComposerModelOptions(
          {
            [runtimeId]: {
              name: 'Runtime name',
              description: 'Runtime description with pricing.',
            },
          },
          {
            [catalogId]: {
              name,
              aliases: [runtimeId],
              description,
              modelFeatures: { speed, intelligence },
            },
          }
        )
      ).toEqual({
        [runtimeId]: {
          name,
          description,
          modelFeatures: { speed, intelligence },
        },
      });
    }
  );

  it('uses the same catalog entry directly when ACP and catalog ids match', () => {
    expect(
      mergeComposerModelOptions(
        { 'gpt-5.6-sol': { name: 'GPT-5.6-Sol' } },
        {
          'gpt-5.6-sol': {
            name: 'GPT-5.6 Sol',
            description: 'Flagship model for the hardest coding workflows.',
            modelFeatures: { speed: 2, intelligence: 5 },
          },
        }
      )
    ).toEqual({
      'gpt-5.6-sol': {
        name: 'GPT-5.6 Sol',
        description: 'Flagship model for the hardest coding workflows.',
        modelFeatures: { speed: 2, intelligence: 5 },
      },
    });
  });

  it('preserves runtime-only models without guessing from their names', () => {
    const available = { preview: { name: 'Provider Preview' } };
    expect(mergeComposerModelOptions(available, {})).toEqual(available);
  });
});
