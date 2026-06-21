/**
 * default-typography.ts — re-exports typography as the legacy CompositeRole
 * shape so existing callers in metrics.ts compile without change.
 *
 * Source of truth is now core/tokens.ts (TYPE_ROLES). This file adapts it to
 * the CompositeRole shape that metrics.ts / fonts.ts consume.
 */

import { MONO_FAMILY_CSS, SANS_FAMILY_CSS, TYPE_ROLES } from '../tokens';

export type CompositeRole = {
  fontFamily: string[];
  fontSize: { value: number; unit: string };
  fontWeight: number;
  lineHeight: { value: number; unit: string };
  fontStyle?: string;
};

function px(value: number) {
  return { value, unit: 'px' };
}

function toComposite(key: keyof typeof TYPE_ROLES): CompositeRole {
  const r = TYPE_ROLES[key] as {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    fontStyle?: string;
  };
  const family = r.fontFamily === 'mono' ? MONO_FAMILY_CSS : SANS_FAMILY_CSS;
  return {
    fontFamily: family.split(', '),
    fontSize: px(r.fontSize),
    fontWeight: r.fontWeight,
    lineHeight: px(r.lineHeight),
    ...(r.fontStyle ? { fontStyle: r.fontStyle } : {}),
  };
}

export const DEFAULT_TYPOGRAPHY: Record<string, CompositeRole> = {
  'type.body': toComposite('body'),
  'type.body-bold': toComposite('body-bold'),
  'type.body-italic': toComposite('body-italic'),
  'type.body-link': toComposite('body-link'),
  'type.h1': toComposite('h1'),
  'type.h2': toComposite('h2'),
  'type.h3': toComposite('h3'),
  'type.inline-code': toComposite('inline-code'),
  'type.mention': toComposite('mention'),
  'type.code': toComposite('code'),
  'type.code-lang': toComposite('code-lang'),
};
