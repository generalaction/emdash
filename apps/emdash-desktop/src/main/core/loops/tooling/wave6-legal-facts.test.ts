import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadWave6LegalFacts,
  parseWave6LegalFacts,
  serializeWave6LegalFactsForPrompt,
} from '@tooling/loops-electron/wave6-legal-facts';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Wave 6 approved legal facts', () => {
  it('accepts a complete consent-mode approval and serializes it deterministically', () => {
    const facts = parseWave6LegalFacts(JSON.stringify(validFacts()));

    expect(facts.privacyMode).toBe('consent');
    expect(facts.optionalTechnologies[0]?.decision).toBe('consent-gated');
    expect(serializeWave6LegalFactsForPrompt(facts)).toBe(JSON.stringify(facts, null, 2));
  });

  it.each(['TBD', '[Placeholder]', 'unknown', 'replace me', 'to be confirmed'])(
    'rejects placeholder legal facts: %s',
    (placeholder) => {
      const input = validFacts();
      input.controller.postalAddress.street = placeholder;

      expect(() => parseWave6LegalFacts(JSON.stringify(input))).toThrow(
        'Wave 6 legal facts contain placeholder or unapproved language'
      );
    }
  );

  it('requires every declared purpose to have an approved legal basis', () => {
    const input = validFacts();
    input.legalBases = [];

    expect(() => parseWave6LegalFacts(JSON.stringify(input))).toThrow(
      'Every approved purpose must have an approved legal basis'
    );
  });

  it('rejects a legal basis for an undeclared purpose', () => {
    const input = validFacts();
    input.legalBases[0]!.purpose = 'Undeclared processing purpose';

    expect(() => parseWave6LegalFacts(JSON.stringify(input))).toThrow(
      'Every approved legal basis must reference an approved purpose'
    );
  });

  it('rejects conflicting duplicate legal bases for one purpose', () => {
    const input = validFacts();
    input.legalBases.push({
      purpose: input.legalBases[0]!.purpose,
      basis: 'contract',
      explanation: 'A conflicting second basis must not be accepted.',
    });

    expect(() => parseWave6LegalFacts(JSON.stringify(input))).toThrow(
      'Each approved purpose must have exactly one legal basis'
    );
  });

  it('requires consent mode to gate at least one real optional technology', () => {
    const input = validFacts();
    input.optionalTechnologies[0]!.decision = 'notice-only';

    expect(() => parseWave6LegalFacts(JSON.stringify(input))).toThrow(
      'Consent mode requires at least one consent-gated optional technology'
    );
  });

  it('forbids fictional consent gates in notice mode', () => {
    const input = validFacts();
    input.privacyMode = 'notice';

    expect(() => parseWave6LegalFacts(JSON.stringify(input))).toThrow(
      'Notice mode cannot declare a consent-gated optional technology'
    );
  });

  it('loads only a bounded regular mode-0600 file', () => {
    const path = writeFactsFile(0o600);

    expect(loadWave6LegalFacts(path)).toMatchObject({ version: 1, privacyMode: 'consent' });

    chmodSync(path, 0o644);
    expect(() => loadWave6LegalFacts(path)).toThrow('Wave 6 legal facts file must be mode 0600');
  });

  it('rejects an oversized input before parsing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'emdash-wave6-facts-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'facts.json');
    writeFileSync(path, 'x'.repeat(65_537), { mode: 0o600 });

    expect(() => loadWave6LegalFacts(path)).toThrow('Wave 6 legal facts file exceeds 65536 bytes');
  });
});

function writeFactsFile(mode: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'emdash-wave6-facts-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'facts.json');
  writeFileSync(path, JSON.stringify(validFacts()), { mode });
  return path;
}

function validFacts() {
  return {
    version: 1 as const,
    approval: {
      approvedBy: 'Product owner',
      approvedAt: '2026-08-05T09:30:00.000Z',
      sourceReference: 'ACP Loops v2 task approval',
    },
    privacyMode: 'consent' as 'consent' | 'notice',
    controller: {
      legalName: 'Example Controller GmbH',
      postalAddress: {
        street: 'Example Street 1',
        postalCode: '10115',
        city: 'Berlin',
        country: 'Germany',
      },
      contactEmail: 'privacy@example.test',
    },
    jurisdiction: {
      country: 'Germany',
      privacyLaw: 'GDPR and applicable German data-protection law',
      supervisoryAuthority: 'Approved supervisory authority',
    },
    effectiveDate: '2026-08-05',
    purposes: ['Provide meeting transcription and summaries', 'Offer optional scheduling'],
    legalBases: [
      {
        purpose: 'Provide meeting transcription and summaries',
        basis: 'contract' as const,
        explanation: 'Necessary to provide the requested service.',
      },
      {
        purpose: 'Offer optional scheduling',
        basis: 'consent' as const,
        explanation: 'Loaded only after an affirmative optional-technology choice.',
      },
    ],
    retention: [
      {
        dataClass: 'Meeting content',
        period: 'Until the user deletes it',
        trigger: 'User deletion request',
        deletionOutcome: 'Meeting records and referenced transcript blobs are deleted.',
      },
    ],
    deletionGuarantees: [
      'Public and scheduled meeting deletion remove the meeting record and transcript blob.',
    ],
    subprocessors: [
      {
        name: 'Example Processor',
        purpose: 'Provide meeting transcription and summaries',
        dataCategories: ['Meeting audio and transcript content'],
        processingLocations: ['European Union'],
        transferMechanism: 'No restricted transfer approved',
      },
    ],
    optionalTechnologies: [
      {
        name: 'Cal.com',
        domains: ['cal.com'],
        purpose: 'Offer optional scheduling',
        decision: 'consent-gated' as 'consent-gated' | 'notice-only' | 'disabled',
      },
    ],
  };
}
