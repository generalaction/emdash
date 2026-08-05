import { type ComponentProps } from 'react';
import { cn } from '@renderer/utils/utils';
import { getPrNumber, type PullRequest } from '@shared/core/pull-requests/pull-requests';
import { rpc } from '../ipc';

type PrNavigationButtonProps = Omit<ComponentProps<'button'>, 'aria-label' | 'onClick' | 'type'> & {
  pr: PullRequest;
  onNavigate?: () => void;
};

export function PrNavigationButton({
  pr,
  className,
  children,
  onNavigate,
  ...props
}: PrNavigationButtonProps) {
  const prNumber = getPrNumber(pr);
  const accessibleLabel = `Open pull request${
    prNumber == null ? '' : ` #${prNumber}`
  }: ${pr.title}`;

  return (
    <button
      {...props}
      type="button"
      aria-label={accessibleLabel}
      className={cn('cursor-pointer', className)}
      onClick={(event) => {
        event.stopPropagation();
        onNavigate?.();
        void rpc.app.openExternal(pr.url);
      }}
    >
      {children}
    </button>
  );
}
