import { describe, expect, it } from 'vitest';
import { toSkillsshCatalogSkill } from './skillssh';

describe('skills.sh catalog helpers', () => {
  it('does not duplicate the display name as a placeholder description', () => {
    const skill = toSkillsshCatalogSkill({
      name: 'find-skills',
      skillId: 'find-skills',
      source: 'vercel-labs/skills',
      installs: 1_500_000,
    });

    expect(skill.displayName).toBe('Find Skills');
    expect(skill.description).toBe('');
    expect(skill.frontmatter.description).toBe('');
  });
});
