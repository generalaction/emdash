import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BrandBar } from './SharePage';

export function NotFound() {
  return (
    <>
      <BrandBar />
      <main className="mx-auto w-[min(840px,calc(100%-40px))] pt-2 pb-42">
        <section className="grid justify-items-start gap-2.5 pt-[14vh]">
          <p className="font-mono text-tiny font-medium tracking-[0.1em] text-foreground-muted uppercase">
            Emdash
          </p>
          <h1 className="text-[clamp(24px,4vw,32px)] [line-height:1.3] font-semibold tracking-[-0.01em]">
            Share not found
          </h1>
          <p className="max-w-[70ch] text-sm leading-relaxed text-foreground-muted">
            This link may have been revoked or typed incorrectly.
          </p>
          <a className={cn(buttonVariants({ size: 'pill' }), 'mt-2.5')} href="https://emdash.sh">
            Download Emdash
          </a>
        </section>
      </main>
    </>
  );
}
