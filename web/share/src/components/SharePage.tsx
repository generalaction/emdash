import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

type SharePageProps = {
  eyebrow: string;
  title: string;
  description: string | null;
  deepLink: string;
  copyText: string;
  children: ReactNode;
};

export function SharePage({
  eyebrow,
  title,
  description,
  deepLink,
  copyText,
  children,
}: SharePageProps) {
  return (
    <main>
      <section className="header">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="description">{description}</p> : null}
        <div className="actions">
          <a className="primary" href={deepLink}>
            Open in Emdash
          </a>
          <CopyButton text={copyText} />
          <a href="https://emdash.sh">Download Emdash</a>
        </div>
      </section>
      {children}
      <footer>
        <p>
          Shared with <a href="https://emdash.sh">Emdash</a> — orchestrate AI coding agents in
          parallel.
        </p>
      </footer>
    </main>
  );
}
