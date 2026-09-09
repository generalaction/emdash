import {
  tokens,
  type SurfaceLevelName,
  type SurfaceRoleName,
  type SurfaceToneName,
} from '@emdash/theme';
import { describe, expect, it } from 'vitest';
import { surface, type SurfaceOptions } from './surface';

const canonicalLevels = [
  'sunken',
  'base',
  'raised',
  'elevated',
  'overlay',
] as const satisfies readonly SurfaceLevelName[];
const canonicalRoles = ['paper'] as const satisfies readonly SurfaceRoleName[];
const canonicalTones = [
  'destructive',
  'warning',
  'info',
  'success',
] as const satisfies readonly SurfaceToneName[];

describe('public surface Recipe', () => {
  it('exposes the canonical Level, Role, and Tone vocabulary', () => {
    expect(Object.keys(tokens.surface.level)).toEqual(canonicalLevels);
    expect(Object.keys(tokens.surface.role)).toEqual(canonicalRoles);
    expect(Object.keys(tokens.surface.tone)).toEqual(canonicalTones);
  });

  it('returns complete classes for every absolute and context-relative Surface axis', () => {
    const classes = [
      ...canonicalLevels.map((level) => surface({ level })),
      ...canonicalRoles.map((role) => surface({ role })),
      ...canonicalTones.map((tone) => surface({ tone })),
      surface({ emphasis: true }),
    ];

    expect(classes.every((className) => className.length > 0)).toBe(true);
    expect(new Set(classes).size).toBe(classes.length);
  });

  it('composes Level and Tone through the same Recipe', () => {
    const levelClass = surface({ level: 'raised' });
    const toneClass = surface({ tone: 'warning' });
    const combinedClass = surface({ level: 'raised', tone: 'warning' });

    expect(combinedClass.split(' ')).toEqual(
      expect.arrayContaining([...levelClass.split(' '), ...toneClass.split(' ')])
    );
  });

  it('rejects an empty selection', () => {
    expect(() => surface({} as SurfaceOptions)).toThrow(
      'surface() requires level, role, tone, or emphasis'
    );
  });
});

function typeCheckRequiredSelection(): void {
  // @ts-expect-error A Surface must establish at least one visual axis.
  surface();
  // @ts-expect-error An empty object does not establish a Surface axis.
  surface({});
}
void typeCheckRequiredSelection;
