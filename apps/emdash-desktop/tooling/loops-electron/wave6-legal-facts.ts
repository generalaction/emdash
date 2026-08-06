import { lstatSync, readFileSync } from 'node:fs';
import z from 'zod';

const MAX_LEGAL_FACTS_BYTES = 65_536;
const placeholderPattern = /(?:\[?placeholder\]?|\btbd\b|\bunknown\b|replace me|to be confirmed)/i;
const approvedText = z.string().trim().min(2).max(2_048);
const approvedTextList = z.array(approvedText).min(1).max(64);

const legalBasisSchema = z.enum(['consent', 'contract', 'legitimate-interest', 'legal-obligation']);

export const wave6LegalFactsSchema = z
  .object({
    version: z.literal(1),
    approval: z
      .object({
        approvedBy: approvedText,
        approvedAt: z.string().datetime({ offset: true }),
        sourceReference: approvedText,
      })
      .strict(),
    privacyMode: z.enum(['consent', 'notice']),
    controller: z
      .object({
        legalName: approvedText,
        postalAddress: z
          .object({
            street: approvedText,
            postalCode: approvedText,
            city: approvedText,
            country: approvedText,
          })
          .strict(),
        contactEmail: z.string().trim().email().max(320),
      })
      .strict(),
    jurisdiction: z
      .object({
        country: approvedText,
        privacyLaw: approvedText,
        supervisoryAuthority: approvedText.optional(),
      })
      .strict(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Effective date must use YYYY-MM-DD'),
    purposes: approvedTextList,
    legalBases: z
      .array(
        z
          .object({
            purpose: approvedText,
            basis: legalBasisSchema,
            explanation: approvedText,
          })
          .strict()
      )
      .min(1)
      .max(64),
    retention: z
      .array(
        z
          .object({
            dataClass: approvedText,
            period: approvedText,
            trigger: approvedText,
            deletionOutcome: approvedText,
          })
          .strict()
      )
      .min(1)
      .max(64),
    deletionGuarantees: approvedTextList,
    subprocessors: z
      .array(
        z
          .object({
            name: approvedText,
            purpose: approvedText,
            dataCategories: approvedTextList,
            processingLocations: approvedTextList,
            transferMechanism: approvedText,
          })
          .strict()
      )
      .min(1)
      .max(64),
    optionalTechnologies: z
      .array(
        z
          .object({
            name: approvedText,
            domains: z
              .array(
                z
                  .string()
                  .trim()
                  .min(1)
                  .max(253)
                  .regex(
                    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
                  )
              )
              .min(1)
              .max(16),
            purpose: approvedText,
            decision: z.enum(['consent-gated', 'notice-only', 'disabled']),
          })
          .strict()
      )
      .max(32),
  })
  .strict()
  .superRefine((facts, context) => {
    const purposesWithBasis = new Set(facts.legalBases.map((entry) => entry.purpose));
    if (facts.purposes.some((purpose) => !purposesWithBasis.has(purpose))) {
      context.addIssue({
        code: 'custom',
        path: ['legalBases'],
        message: 'Every approved purpose must have an approved legal basis',
      });
    }

    if (facts.legalBases.some((entry) => !facts.purposes.includes(entry.purpose))) {
      context.addIssue({
        code: 'custom',
        path: ['legalBases'],
        message: 'Every approved legal basis must reference an approved purpose',
      });
    }

    for (const entry of [...facts.subprocessors, ...facts.optionalTechnologies]) {
      if (!facts.purposes.includes(entry.purpose)) {
        context.addIssue({
          code: 'custom',
          path: ['purposes'],
          message: 'Every processor and optional technology purpose must be approved',
        });
        break;
      }
    }

    if (
      facts.privacyMode === 'consent' &&
      !facts.optionalTechnologies.some((technology) => technology.decision === 'consent-gated')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['optionalTechnologies'],
        message: 'Consent mode requires at least one consent-gated optional technology',
      });
    }

    if (
      facts.privacyMode === 'notice' &&
      facts.optionalTechnologies.some((technology) => technology.decision === 'consent-gated')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['optionalTechnologies'],
        message: 'Notice mode cannot declare a consent-gated optional technology',
      });
    }

    addDuplicateIssue(context, facts.purposes, ['purposes'], 'Approved purposes must be unique');
    addDuplicateIssue(
      context,
      facts.legalBases.map((entry) => entry.purpose),
      ['legalBases'],
      'Each approved purpose must have exactly one legal basis'
    );
    addDuplicateIssue(
      context,
      facts.retention.map((entry) => entry.dataClass),
      ['retention'],
      'Retention data classes must be unique'
    );
    addDuplicateIssue(
      context,
      facts.subprocessors.map((entry) => entry.name),
      ['subprocessors'],
      'Approved subprocessors must be unique'
    );
    addDuplicateIssue(
      context,
      facts.optionalTechnologies.map((entry) => entry.name),
      ['optionalTechnologies'],
      'Optional technologies must be unique'
    );
  });

export type Wave6LegalFacts = z.infer<typeof wave6LegalFactsSchema>;

export function parseWave6LegalFacts(contents: string): Wave6LegalFacts {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('Wave 6 legal facts file is not valid JSON');
  }

  if (containsPlaceholder(value)) {
    throw new Error('Wave 6 legal facts contain placeholder or unapproved language');
  }

  const parsed = wave6LegalFactsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

export function loadWave6LegalFacts(path: string): Wave6LegalFacts {
  const metadata = lstatSync(path);
  if (!metadata.isFile()) throw new Error('Wave 6 legal facts path must be a regular file');
  if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600) {
    throw new Error('Wave 6 legal facts file must be mode 0600');
  }
  if (metadata.size > MAX_LEGAL_FACTS_BYTES) {
    throw new Error(`Wave 6 legal facts file exceeds ${MAX_LEGAL_FACTS_BYTES} bytes`);
  }
  return parseWave6LegalFacts(readFileSync(path, 'utf8'));
}

export function serializeWave6LegalFactsForPrompt(facts: Wave6LegalFacts): string {
  return JSON.stringify(facts, null, 2);
}

function containsPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return placeholderPattern.test(value);
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  if (value && typeof value === 'object') return Object.values(value).some(containsPlaceholder);
  return false;
}

function addDuplicateIssue(
  context: z.RefinementCtx,
  values: string[],
  path: PropertyKey[],
  message: string
): void {
  const normalized = values.map((value) => value.trim().toLocaleLowerCase('en-US'));
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: 'custom', path, message });
  }
}
