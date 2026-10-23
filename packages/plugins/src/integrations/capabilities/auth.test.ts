import { describe, expect, it } from 'vitest';
import { integrationAuthCapability } from './auth';

const schema = integrationAuthCapability.descriptorSchema;
const form = { kind: 'form', fields: [{ id: 'token', label: 'Token' }] };

describe('integration authentication methods', () => {
  it('preserves unnamed single forms and distinct acquisition kinds', () => {
    expect(schema.safeParse({ methods: [form] }).success).toBe(true);
    expect(
      schema.safeParse({
        methods: [
          { kind: 'oauth', providerId: 'github' },
          { kind: 'oauth-device', clientId: 'client', scopes: ['repo'] },
          { kind: 'cli-import', cli: 'gh' },
        ],
      }).success
    ).toBe(true);
  });

  it('accepts explicitly identified and labelled form alternatives', () => {
    const { methods } = schema.parse({
      methods: [
        { ...form, id: ' basic ', label: ' Email + API token ' },
        { ...form, id: 'bearer', label: 'Bearer token' },
      ],
    });
    expect(methods[0]).toMatchObject({ id: 'basic', label: 'Email + API token' });
  });

  it.each([
    { id: undefined, label: 'Bearer token' },
    { id: '', label: 'Bearer token' },
    { id: ' basic ', label: 'Duplicate ID' },
    { id: 'bearer', label: undefined },
    { id: 'bearer', label: '   ' },
  ])('rejects ambiguous form alternatives: %j', (alternative) => {
    expect(
      schema.safeParse({
        methods: [
          { ...form, id: 'basic', label: 'Email + API token' },
          { ...form, ...alternative },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects empty identifiers and labels even for a single named form', () => {
    expect(schema.safeParse({ methods: [{ ...form, id: ' ' }] }).success).toBe(false);
    expect(schema.safeParse({ methods: [{ ...form, label: ' ' }] }).success).toBe(false);
  });
});
