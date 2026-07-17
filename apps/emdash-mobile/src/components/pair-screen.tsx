import { Button, Input } from '@emdash/ui/react';
import { LockKeyhole, ShieldCheck, Wifi } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { normalizePairingCode, validPairingCode } from '../model';
import { BrandMark } from './brand-mark';

export function PairScreen({
  onPair,
  initialError,
}: {
  onPair: (code: string) => Promise<void>;
  initialError?: string;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(initialError ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validPairingCode(code)) {
      setError('Enter the eight-digit code shown on your desktop.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onPair(code);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pairing failed. Try a new code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="pair-screen">
      <div className="pair-glow" />
      <section className="pair-card" aria-labelledby="pair-title">
        <div className="pair-brand">
          <BrandMark size={42} />
          <span>Emdash</span>
        </div>
        <div className="pair-icon">
          <LockKeyhole size={25} strokeWidth={1.8} />
        </div>
        <h1 id="pair-title">Connect to your desktop</h1>
        <p className="pair-lead">
          In Emdash, open <strong>Settings → Mobile Access</strong> and generate a pairing code.
        </p>
        <form onSubmit={handleSubmit} className="pair-form">
          <label htmlFor="pair-code">Pairing code</label>
          <Input
            id="pair-code"
            className="pair-code-input"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={8}
            placeholder="00000000"
            aria-describedby={error ? 'pair-error' : 'pair-help'}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setCode(normalizePairingCode(event.target.value));
              setError('');
            }}
          />
          {error ? (
            <p id="pair-error" className="form-error" role="alert">
              {error}
            </p>
          ) : (
            <p id="pair-help" className="form-help">
              Codes expire after five minutes and can only be used once.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="primary-action"
            disabled={submitting || !validPairingCode(code)}
          >
            {submitting ? <span className="spinner" /> : <Wifi size={17} />}
            {submitting ? 'Connecting…' : 'Connect to desktop'}
          </Button>
        </form>
        <div className="pair-safety">
          <ShieldCheck size={17} />
          <p>
            Mobile Access v1 uses plaintext HTTP. Only connect on private Wi-Fi or a VPN you trust,
            and never expose this address to the public internet. Access ends when Emdash restarts.
          </p>
        </div>
      </section>
    </main>
  );
}
