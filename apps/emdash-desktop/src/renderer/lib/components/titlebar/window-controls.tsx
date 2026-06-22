import { detectPlatform } from '@tanstack/react-hotkeys';
import { Copy, Minus, Square, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { windowMaximizeChangedChannel } from '@shared/events/appEvents';

const isLinux = detectPlatform() === 'linux';

/**
 * Linux-only top overlay providing a draggable strip and window controls for
 * full-screen views that do not render the {@link Titlebar} (onboarding and the
 * welcome splash). Sits above the welcome screen's `z-50` overlay. No-op on
 * macOS/Windows, which keep their native frame or traffic lights.
 */
export function FramelessTitlebarOverlay() {
  if (!isLinux) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-60 flex h-10 items-center justify-end [-webkit-app-region:drag]">
      <WindowControls />
    </div>
  );
}

/**
 * Custom window controls (minimize / maximize / close) for the frameless Linux
 * window. macOS keeps its native traffic lights and Windows keeps the native
 * frame, so this is only rendered on Linux (see Titlebar).
 */
export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void rpc.app.isWindowMaximized().then(setIsMaximized);
    return events.on(windowMaximizeChangedChannel, ({ maximized }) => setIsMaximized(maximized));
  }, []);

  return (
    <div className="flex h-full items-center [-webkit-app-region:no-drag]">
      <ControlButton label="Minimize" onClick={() => void rpc.app.minimizeWindow()}>
        <Minus className="h-4 w-4" />
      </ControlButton>
      <ControlButton
        label={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => void rpc.app.toggleMaximizeWindow()}
      >
        {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </ControlButton>
      <ControlButton label="Close" danger onClick={() => void rpc.app.closeWindow()}>
        <X className="h-4 w-4" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-10 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-muted',
        danger && 'hover:bg-red-500 hover:text-white'
      )}
    >
      {children}
    </button>
  );
}
