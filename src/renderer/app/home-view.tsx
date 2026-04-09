import emdashLogoWhite from '@/assets/images/emdash/emdash_logo_white.svg';
import emdashLogo from '@/assets/images/emdash/emdash_logo.svg';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useTheme } from '@renderer/lib/hooks/useTheme';

export function HomeTitlebar() {
  return <Titlebar />;
}

export function HomeMainPanel() {
  const { effectiveTheme } = useTheme();
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="container mx-auto flex min-h-full max-w-3xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <div className="logo-shimmer-container">
              <img
                key={effectiveTheme}
                src={effectiveTheme === 'emdark' ? emdashLogoWhite : emdashLogo}
                alt="Emdash"
                className="logo-shimmer-image"
              />
              <span
                className="logo-shimmer-overlay"
                aria-hidden="true"
                style={{
                  WebkitMaskImage: `url(${effectiveTheme === 'emdark' ? emdashLogoWhite : emdashLogo})`,
                  maskImage: `url(${effectiveTheme === 'emdark' ? emdashLogoWhite : emdashLogo})`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
            </div>
          </div>
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            Agentic Development Environment
          </p>
        </div>
      </div>
    </div>
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
