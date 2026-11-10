// Mirrors lib/waitlist.ts in emdash.com: the signup is a cloud_inquiries row so
// the existing notification pipeline picks it up, and the optional note is a
// separate waitlist_notes insert, so it survives an email that already signed up.
const WAITLIST_MESSAGE_PREFIX = 'Emdash 2.0 waitlist';
const NOTE_MAX_LENGTH = 2000;

export type WaitlistSignupConfig = {
  url?: string;
  anonKey?: string;
  /** Where the signup came from, e.g. "desktop app v1.2.10". */
  source: string;
};

export async function joinWaitlist(
  config: WaitlistSignupConfig,
  args: { email: string; note: string }
): Promise<void> {
  const { url, anonKey, source } = config;
  if (!url || !anonKey) throw new Error('Waitlist signup is not configured');

  const email = args.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required');

  const insert = (table: string, row: Record<string, string>) =>
    fetch(`${url.replace(/\/+$/, '')}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });

  const signup = await insert('cloud_inquiries', {
    email,
    message: `${WAITLIST_MESSAGE_PREFIX}\n\nSource: ${source}`,
  });
  // 409 is a unique violation: the email is already on the list, which the
  // website also treats as a successful signup.
  if (!signup.ok && signup.status !== 409) await throwResponseError('signup', signup);

  const note = args.note.trim().slice(0, NOTE_MAX_LENGTH);
  if (!note) return;
  const noteResponse = await insert('waitlist_notes', { email, note, source });
  if (!noteResponse.ok) await throwResponseError('note', noteResponse);
}

async function throwResponseError(what: string, response: Response): Promise<never> {
  const detail = await response.text().catch(() => '');
  throw new Error(`Waitlist ${what} returned ${response.status}${detail ? `: ${detail}` : ''}`);
}
