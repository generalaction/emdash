/**
 * Syntax token template: maps each abstract SyntaxRole to TextMate grammar
 * scope selectors used by Shiki / VSCode themes.
 *
 * Scope ordering follows the gh-dark / gh-light theme tokenColors conventions
 * so generated themes produce visually coherent results out of the box.
 *
 * Each role also carries a default palette assignment expressed as a typed
 * ColorRef (t.<scale>[<step>]), calibrated to reproduce github-light and
 * github-dark from our palette. The generator can override individual
 * assignments per theme via ThemeInput.syntax.roleOverrides.
 */

import type { SyntaxRole } from './roles';
import { defineSyntax, t, type SyntaxScopeEntry } from './token-ref';

export type { SyntaxScopeEntry };

/**
 * Full scope-to-role map.  Shiki resolves scopes coarse-to-fine so broad
 * prefixes (e.g. "keyword") catch all sub-scopes unless overridden.
 */
export const syntaxVars: Record<SyntaxRole, SyntaxScopeEntry> = defineSyntax({
  comment: {
    scopes: ['comment', 'punctuation.definition.comment', 'string.comment'],
    lightDefault: t.neutral[9],
    darkDefault: t.neutral[9],
  },
  keyword: {
    scopes: [
      'keyword',
      'storage.type',
      'storage.modifier',
      'keyword.control',
      'keyword.operator.new',
      'keyword.other.using',
      'keyword.other.import',
      'keyword.other.package',
    ],
    lightDefault: t.red[11],
    darkDefault: t.red[11],
  },
  string: {
    scopes: [
      'string',
      'string.quoted',
      'string.template',
      'string.interpolated',
      'punctuation.definition.string',
    ],
    lightDefault: t.blue[11],
    darkDefault: t.blue[11],
  },
  number: {
    scopes: ['constant.numeric', 'constant.language', 'constant.character', 'constant.other'],
    lightDefault: t.blue[11],
    darkDefault: t.blue[11],
  },
  function: {
    scopes: ['entity.name.function', 'support.function', 'meta.function-call', 'variable.function'],
    lightDefault: t.accent[11],
    darkDefault: t.accent[11],
  },
  type: {
    scopes: [
      'entity.name.type',
      'entity.name.class',
      'entity.name.namespace',
      'entity.name.enum',
      'entity.name.interface',
      'support.class',
      'support.type',
    ],
    lightDefault: t.amber[11],
    darkDefault: t.amber[11],
  },
  variable: {
    scopes: ['variable', 'variable.other', 'variable.parameter', 'meta.definition.variable'],
    lightDefault: t.neutral[12],
    darkDefault: t.neutral[12],
  },
  property: {
    scopes: [
      'variable.other.property',
      'variable.other.object.property',
      'support.variable.property',
      'meta.object-literal.key',
    ],
    lightDefault: t.neutral[11],
    darkDefault: t.neutral[11],
  },
  operator: {
    scopes: [
      'keyword.operator',
      'punctuation.accessor',
      'punctuation.separator',
      'meta.brace',
      'punctuation',
    ],
    lightDefault: t.neutral[10],
    darkDefault: t.neutral[10],
  },
  tag: {
    scopes: ['entity.name.tag', 'meta.tag', 'punctuation.definition.tag'],
    lightDefault: t.green[11],
    darkDefault: t.green[11],
  },
  attribute: {
    scopes: ['entity.other.attribute-name', 'meta.attribute'],
    lightDefault: t.blue[11],
    darkDefault: t.blue[11],
  },
  regexp: {
    scopes: ['string.regexp', 'constant.character.escape', 'constant.other.character-class.regexp'],
    lightDefault: t.blue[11],
    darkDefault: t.blue[11],
  },
});
