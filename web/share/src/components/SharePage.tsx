import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmdashLogo } from '../../../../src/renderer/lib/emdash-logo';
import { CopyButton } from './CopyButton';

const DOWNLOAD_URL = 'https://emdash.sh';

/** Shared page gutter: 840px column with 20px side margins on small screens. */
const PAGE_COLUMN = 'mx-auto w-[min(840px,calc(100%-40px))]';

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
      className="size-4 transition-transform group-hover:translate-x-0.5"
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
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export function BrandBar() {
  return (
    <nav className={cn(PAGE_COLUMN, 'flex items-center justify-between pt-6 pb-4')}>
      <a href={DOWNLOAD_URL} className="inline-flex text-foreground" aria-label="Emdash">
        <EmdashLogo height={15} />
      </a>
      <a href={DOWNLOAD_URL} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
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
      <main className={cn(PAGE_COLUMN, 'pt-2 pb-42')}>
        <article className="overflow-hidden rounded-xl border border-border bg-background-1">
          <header className="flex items-start gap-4 p-6 max-[560px]:p-4">
            <div className="grid size-12 flex-none place-items-center rounded-xl bg-foreground text-background">
              <EmdashMark className="w-6" />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <p className="font-mono text-tiny font-medium tracking-[0.1em] text-foreground-muted uppercase">
                {eyebrow}
              </p>
              <h1 className="text-xl [line-height:1.3] font-semibold tracking-[-0.01em] wrap-anywhere">
                {title}
              </h1>
              {description ? (
                <p className="max-w-[70ch] text-sm leading-relaxed text-foreground-muted">
                  {description}
                </p>
              ) : null}
              {meta ? <div className="mt-0.5">{meta}</div> : null}
            </div>
          </header>
          {children}
        </article>
        <footer className="mt-5 text-xs text-foreground-passive">
          <p>
            Shared with{' '}
            <a
              href={DOWNLOAD_URL}
              className="underline decoration-current/50 hover:text-foreground hover:decoration-current"
            >
              Emdash
            </a>{' '}
            — orchestrate AI coding agents in parallel.
          </p>
        </footer>
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-center gap-2.5 bg-linear-to-t from-background from-62% to-transparent px-5 pt-10 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <a
          className={cn(
            buttonVariants({ size: 'pill' }),
            'group pointer-events-auto w-[min(560px,100%)]'
          )}
          href={deepLink}
        >
          Add to Emdash
          <ArrowRight />
        </a>
        <p className="pointer-events-auto text-xs text-foreground-muted">
          Don&rsquo;t have the desktop app?{' '}
          <a
            href={DOWNLOAD_URL}
            className="underline decoration-current/50 hover:text-foreground hover:decoration-current"
          >
            Download Emdash
          </a>
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

/** Monospace prompt body inside a ContentPane. */
export function PromptText({ children }: { children: ReactNode }) {
  return (
    <pre className="font-mono text-code leading-[1.6] whitespace-pre-wrap text-foreground">
      <code>{children}</code>
    </pre>
  );
}

/** File-style content pane: tab strip with the file name and a copy action. */
export function ContentPane({ label, copyText, children }: ContentPaneProps) {
  return (
    <section className="border-t border-border bg-background">
      <div className="flex items-center justify-between border-b border-border py-2 pr-3 pl-6 max-[560px]:pl-4">
        <span className="inline-flex items-center gap-2 font-mono text-xs text-foreground-muted">
          <FileIcon />
          {label}
        </span>
        <CopyButton text={copyText} />
      </div>
      <div className="overflow-x-auto p-6 max-[560px]:p-4">{children}</div>
    </section>
  );
}
