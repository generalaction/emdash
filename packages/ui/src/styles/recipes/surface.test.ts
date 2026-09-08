import {
  SURFACE_LEVELS,
  SURFACE_ROLES,
  SURFACE_TONES,
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
    expect(SURFACE_LEVELS).toEqual(canonicalLevels);
    expect(SURFACE_ROLES).toEqual(canonicalRoles);
    expect(SURFACE_TONES).toEqual(canonicalTones);
  });

  it('returns complete classes for every absolute and context-relative Surface axis', () => {
    const classes = [
      ...SURFACE_LEVELS.map((level) => surface({ level })),
      ...SURFACE_ROLES.map((role) => surface({ role })),
      ...SURFACE_TONES.map((tone) => surface({ tone })),
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
