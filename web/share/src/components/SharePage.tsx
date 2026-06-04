import type { ReactNode } from 'react';
import { EmdashLogo } from '../../../../src/renderer/lib/emdash-logo';
import { CopyButton } from './CopyButton';

const DOWNLOAD_URL = 'https://emdash.sh';

/** The em-dash glyph from the wordmark, used as the brand tile. */
function EmdashMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 23.2454 103.519 27.8798" className={className} aria-hidden="true">
      <path d="M23.235 23.2454H103.519L80.2841 51.1252H0L23.235 23.2454Z" fill="currentColor" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="cta-arrow"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pane-file-icon"
      aria-hidden="true"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export function BrandBar() {
  return (
    <nav className="brand-bar">
      <a href={DOWNLOAD_URL} className="brand-logo" aria-label="Emdash">
        <EmdashLogo height={15} />
      </a>
      <a href={DOWNLOAD_URL} className="brand-download">
        Download
      </a>
    </nav>
  );
}

type SharePageProps = {
  eyebrow: string;
  title: string;
  description: string | null;
  meta?: ReactNode;
  deepLink: string;
  children: ReactNode;
};

export function SharePage({
  eyebrow,
  title,
  description,
  meta,
  deepLink,
  children,
}: SharePageProps) {
  return (
    <>
      <BrandBar />
      <main>
        <article className="share-card">
          <header className="share-card-header">
            <div className="icon-tile">
              <EmdashMark className="icon-tile-mark" />
            </div>
            <div className="share-card-heading">
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              {description ? <p className="description">{description}</p> : null}
              {meta ? <div className="share-card-meta">{meta}</div> : null}
            </div>
          </header>
          {children}
        </article>
        <footer>
          <p>
            Shared with <a href={DOWNLOAD_URL}>Emdash</a> — orchestrate AI coding agents in
            parallel.
          </p>
        </footer>
      </main>
      <div className="cta-bar">
        <a className="cta-pill" href={deepLink}>
          Add to Emdash
          <ArrowRight />
        </a>
        <p className="cta-hint">
          Don&rsquo;t have the desktop app? <a href={DOWNLOAD_URL}>Download Emdash</a>
        </p>
      </div>
    </>
  );
}

type ContentPaneProps = {
  label: string;
  copyText: string;
  children: ReactNode;
};

/** File-style content pane: tab strip with the file name and a copy action. */
export function ContentPane({ label, copyText, children }: ContentPaneProps) {
  return (
    <section className="share-pane">
      <div className="pane-tab">
        <span className="pane-tab-label">
          <FileIcon />
          {label}
        </span>
        <CopyButton text={copyText} />
      </div>
      <div className="pane-content">{children}</div>
    </section>
  );
}
