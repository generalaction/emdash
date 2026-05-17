import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMOTE_NAME,
  resolveConfiguredRemotes,
  selectPreferredRemote,
} from '@shared/git-utils';

const r = (name: string, url = '') => ({ name, url });

describe('selectPreferredRemote', () => {
  it('returns origin remote when setting is empty', () => {
    expect(selectPreferredRemote(undefined, [r('origin')])).toEqual(r('origin'));
    expect(selectPreferredRemote('', [r('origin')])).toEqual(r('origin'));
    expect(selectPreferredRemote('   ', [r('origin')])).toEqual(r('origin'));
  });

  it('returns configured remote when it exists', () => {
    expect(selectPreferredRemote('upstream', [r('origin'), r('upstream')])).toEqual(r('upstream'));
  });

  it('falls back to origin when configured remote does not exist', () => {
    expect(selectPreferredRemote('upstream', [r('origin')])).toEqual(r('origin'));
  });

  it('falls back to sentinel when no remotes are listed', () => {
    expect(selectPreferredRemote('upstream', [])).toEqual({ name: DEFAULT_REMOTE_NAME, url: '' });
  });
});

describe('resolveConfiguredRemotes', () => {
  it('resolves configured base and push remotes when both exist', () => {
    expect(
      resolveConfiguredRemotes({ baseRemote: 'upstream', pushRemote: 'origin' }, [
        r('origin'),
        r('upstream'),
      ])
    ).toEqual({
      baseRemote: r('upstream'),
      pushRemote: r('origin'),
    });
  });

  it('falls back to base remote when push remote is unset or unknown', () => {
    expect(
      resolveConfiguredRemotes({ baseRemote: 'upstream' }, [r('origin'), r('upstream')])
    ).toEqual({
      baseRemote: r('upstream'),
      pushRemote: r('upstream'),
    });
    expect(
      resolveConfiguredRemotes({ baseRemote: 'upstream', pushRemote: 'missing' }, [
        r('origin'),
        r('upstream'),
      ])
    ).toEqual({
      baseRemote: r('upstream'),
      pushRemote: r('upstream'),
    });
  });
});
