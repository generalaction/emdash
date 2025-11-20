import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Info, X } from 'lucide-react';

import openaiLogo from '../../assets/images/openai.png';
import claudeLogo from '../../assets/images/claude.png';
import copilotLogo from '../../assets/images/ghcopilot.png';
import githubLogo from '../../assets/images/github.png';
import jiraLogo from '../../assets/images/jira.png';
import linearLogo from '../../assets/images/linear.png';
import cursorLogo from '../../assets/images/cursorlogo.png';
import gooseLogo from '../../assets/images/goose.png';
import geminiLogo from '../../assets/images/gemini.png';
import qwenLogo from '../../assets/images/qwen.png';
import kimiLogo from '../../assets/images/kimi.png';
import augmentcodeLogo from '../../assets/images/augmentcode.png';

type HowToUseEmdashProps = {
  defaultOpen?: boolean;
  className?: string;
};

const providerIcons = [
  { src: openaiLogo, alt: 'OpenAI' },
  { src: claudeLogo, alt: 'Claude' },
  { src: githubLogo, alt: 'GitHub' },
  { src: copilotLogo, alt: 'GitHub Copilot' },
  { src: cursorLogo, alt: 'Cursor' },
  { src: gooseLogo, alt: 'Goose' },
  { src: geminiLogo, alt: 'Gemini' },
  { src: qwenLogo, alt: 'Qwen' },
  { src: kimiLogo, alt: 'Kimi' },
  { src: augmentcodeLogo, alt: 'AugmentCode' },
] as const;

const HowToUseEmdash: React.FC<HowToUseEmdashProps> = ({ defaultOpen = false, className }) => {
  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const reduceMotion = useReducedMotion();

  const modalContent = (
    <motion.div
      onClick={(e) => e.stopPropagation()}
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 6, scale: 0.995 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="mx-4 w-full max-w-md rounded-xl border border-border/50 bg-background shadow-2xl"
      role="document"
    >
      <header className="flex items-center justify-between px-4 py-2">
        <h3 className="text-sm font-medium">How to use Emdash</h3>
        <button
          type="button"
          aria-label="Close"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="space-y-2 p-4 pt-3">
        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-background text-[10px] font-semibold text-muted-foreground">
              1
            </span>
            <span className="text-xs font-medium text-foreground">Open project</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Select the repository you want to work on in Emdash.
          </p>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-background text-[10px] font-semibold text-muted-foreground">
              2
            </span>
            <span className="text-xs font-medium text-foreground">Create a task</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Each task runs in an isolated git worktree where agents focus on a single goal. It keeps
            changes clean and scoped, so you can run several in parallel.
          </p>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-background text-[10px] font-semibold text-muted-foreground">
                3
              </span>
              <span className="text-xs font-medium text-foreground">Choose your providers</span>
            </div>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Emdash is provider‑agnostic and works with any popular CLI agent provider.
          </p>
          <div className="mt-2">
            <div className="mx-auto grid max-w-[420px] grid-cols-5 gap-2.5">
              {providerIcons.map((icon, idx) => (
                <div
                  key={icon.alt + idx}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background shadow-sm"
                >
                  <img
                    src={icon.src}
                    alt={icon.alt}
                    className="h-4 w-4 object-contain"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-background text-[10px] font-semibold text-muted-foreground">
              4
            </span>
            <span className="text-xs font-medium text-foreground">Assign tasks to agents</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Run multiple agents in parallel, review diffs side‑by‑side, and merge when ready.
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            You can pass issues (Linear, Jira, GitHub) directly to agents.
          </p>
          <div className="mt-2 flex items-center justify-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background shadow-sm">
              <img src={linearLogo} alt="Linear" className="h-5 w-5 object-contain" />
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background shadow-sm">
              <img src={jiraLogo} alt="Jira" className="h-5 w-5 object-contain" />
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background shadow-sm">
              <img src={githubLogo} alt="GitHub" className="h-5 w-5 object-contain" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={className}>
      <div className="mx-auto w-fit">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground/80"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls="how-to-ndash"
        >
          <Info className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
          <span>How to use Emdash</span>
        </button>
      </div>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  id="how-to-ndash"
                  role="dialog"
                  aria-modal="true"
                  aria-label="How to use Emdash"
                  className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
                  onClick={() => setOpen(false)}
                >
                  {modalContent}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
};

export default HowToUseEmdash;
