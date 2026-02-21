import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(os.tmpdir()),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
}));

// Mock logger
vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  parseFrontmatter,
  isValidSkillName,
  generateSkillMd,
} from '../../shared/skills/validation';

describe('Skills validation', () => {
  describe('isValidSkillName', () => {
    it('accepts valid names', () => {
      expect(isValidSkillName('code-review')).toBe(true);
      expect(isValidSkillName('my-skill')).toBe(true);
      expect(isValidSkillName('a1')).toBe(true);
      expect(isValidSkillName('test')).toBe(true);
    });

    it('rejects invalid names', () => {
      expect(isValidSkillName('')).toBe(false);
      expect(isValidSkillName('Code-Review')).toBe(false);
      expect(isValidSkillName('my_skill')).toBe(false);
      expect(isValidSkillName('has--double')).toBe(false);
      expect(isValidSkillName('-starts-with-dash')).toBe(false);
      expect(isValidSkillName('has space')).toBe(false);
    });
  });

  describe('parseFrontmatter', () => {
    it('parses valid YAML frontmatter', () => {
      const content = `---
name: "My Skill"
description: "Does things"
license: MIT
---

# My Skill

Some content here.`;
      const result = parseFrontmatter(content);
      expect(result.frontmatter.name).toBe('My Skill');
      expect(result.frontmatter.description).toBe('Does things');
      expect(result.frontmatter.license).toBe('MIT');
      expect(result.body).toContain('# My Skill');
    });

    it('handles content without frontmatter', () => {
      const content = '# Just Markdown\n\nNo frontmatter here.';
      const result = parseFrontmatter(content);
      expect(result.frontmatter.name).toBe('');
      expect(result.frontmatter.description).toBe('');
      expect(result.body).toBe(content);
    });

    it('handles single-quoted values', () => {
      const content = `---
name: 'Single Quoted'
description: 'Description here'
---

Body`;
      const result = parseFrontmatter(content);
      expect(result.frontmatter.name).toBe('Single Quoted');
      expect(result.frontmatter.description).toBe('Description here');
    });
  });

  describe('generateSkillMd', () => {
    it('generates valid SKILL.md content', () => {
      const content = generateSkillMd('my-skill', 'A test skill');
      expect(content).toContain('name: "my-skill"');
      expect(content).toContain('description: "A test skill"');
      expect(content).toContain('# my-skill');

      const parsed = parseFrontmatter(content);
      expect(parsed.frontmatter.name).toBe('my-skill');
      expect(parsed.frontmatter.description).toBe('A test skill');
    });

    it('escapes double quotes in description and roundtrips correctly', () => {
      const content = generateSkillMd('my-skill', 'Handles "quoted" text');
      const parsed = parseFrontmatter(content);
      expect(parsed.frontmatter.description).toBe('Handles "quoted" text');
    });

    it('accepts optional body and uses it instead of default', () => {
      const body = 'Custom instructions here.';
      const content = generateSkillMd('my-skill', 'A test', body);
      const parsed = parseFrontmatter(content);
      expect(parsed.body.trim()).toBe(body);
    });
  });
});

describe('SkillsService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('can create and read a skill directory', async () => {
    const skillDir = path.join(tmpDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const content = generateSkillMd('test-skill', 'A test');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);

    const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    const { frontmatter } = parseFrontmatter(skillMd);
    expect(frontmatter.name).toBe('test-skill');
  });

  it('can list skills from a directory', async () => {
    // Create two skills
    for (const name of ['skill-a', 'skill-b']) {
      const dir = path.join(tmpDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), generateSkillMd(name, `Desc for ${name}`));
    }
    // Also create a non-skill dir
    fs.mkdirSync(path.join(tmpDir, '.emdash'), { recursive: true });

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const skills = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .filter((e) => fs.existsSync(path.join(tmpDir, e.name, 'SKILL.md')));

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['skill-a', 'skill-b']);
  });
});
