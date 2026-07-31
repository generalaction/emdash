import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { family } from './family';

describe('state family', () => {
  it('disposes unretained entries after their linger window', async () => {
    const clock = createManualClock();
    const disposed: string[] = [];
    const members = family(
      (key: string, scope) => {
        scope.add(() => {
          disposed.push(key);
        });
        return { key };
      },
      { clock, lingerMs: 10 }
    );

    const member = members('one');
    expect(members.peekMember('one')).toBe(member);

    await clock.advanceBy(9);
    expect(members.peekMember('one')).toBe(member);
    await clock.advanceBy(1);

    expect(members.peekMember('one')).toBeUndefined();
    expect(disposed).toEqual(['one']);
    await members.dispose();
  });

  it('re-arms linger when an unretained entry is accessed during its linger window', async () => {
    const clock = createManualClock();
    const disposed: string[] = [];
    const members = family(
      (key: string, scope) => {
        scope.add(() => {
          disposed.push(key);
        });
        return { key };
      },
      { clock, lingerMs: 10 }
    );

    const member = members('one');
    await clock.advanceBy(5);
    expect(members('one')).toBe(member);
    await clock.advanceBy(5);
    expect(members.peekMember('one')).toBe(member);
    await clock.advanceBy(5);

    expect(members.peekMember('one')).toBeUndefined();
    expect(disposed).toEqual(['one']);
    await members.dispose();
  });

  it('keeps retained entries alive until the retain handle is released', async () => {
    const clock = createManualClock();
    const disposed: string[] = [];
    const members = family(
      (key: string, scope) => {
        scope.add(() => {
          disposed.push(key);
        });
        return { key };
      },
      { clock, lingerMs: 10 }
    );

    const release = members.retain('one');
    const member = members.peekMember('one');
    await clock.advanceBy(20);
    expect(members.peekMember('one')).toBe(member);

    release();
    await clock.advanceBy(10);
    expect(members.peekMember('one')).toBeUndefined();
    expect(disposed).toEqual(['one']);
    await members.dispose();
  });

  it('disposes all entry scopes when the family is disposed', async () => {
    const disposed: string[] = [];
    const members = family((key: string, scope) => {
      scope.add(() => {
        disposed.push(key);
      });
      return { key };
    });

    members('one');
    members('two');
    await members.dispose();

    expect(disposed.sort()).toEqual(['one', 'two']);
  });
});
