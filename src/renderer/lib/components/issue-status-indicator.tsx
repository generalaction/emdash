import { cn } from '@renderer/utils/utils';

export type IssueStatus =
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'backlog'
  | 'duplicate'
  | 'triage';

export function IssueStatusIndicator({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  switch (status) {
    case 'done':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 512 512"
          className={cn('size-3 fill-status-done hover:fill-status-done-hover shrink-0', className)}
          height="1em"
          width="1em"
        >
          <path d="M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zM227.314 387.314l184-184c6.248-6.248 6.248-16.379 0-22.627l-22.627-22.627c-6.248-6.249-16.379-6.249-22.628 0L216 308.118l-70.059-70.059c-6.248-6.248-16.379-6.248-22.628 0l-22.627 22.627c-6.248 6.248-6.248 16.379 0 22.627l104 104c6.249 6.249 16.379 6.249 22.628.001z" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 512 512"
          className={cn(
            'size-3 fill-status-canceled hover:fill-status-canceled-hover shrink-0',
            className
          )}
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path>
        </svg>
      );
    case 'in_progress':
      return (
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={cn(
            'size-3 text-status-in-progress hover:text-status-in-progress-hover shrink-0',
            className
          )}
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"></circle>
          <path d="M 8 3 A 5 5 0 0 1 8 13 L 8 8 Z" fill="currentColor"></path>
        </svg>
      );
    case 'review':
      return (
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={cn(
            'size-3 text-status-in-review hover:text-status-in-review-hover shrink-0',
            className
          )}
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"></circle>
          <path d="M 8 3 A 5 5 0 1 1 3 8 L 8 8 Z" fill="currentColor"></path>
        </svg>
      );
    case 'backlog':
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn('shrink-0 size-3', className)}>
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke="lch(68.75% 3.577 260.65)"
            stroke-width="1.5"
            stroke-dasharray="1.4 1.74"
            stroke-dashoffset="0.65"
          ></circle>
          <circle
            cx="7"
            cy="7"
            r="2"
            fill="none"
            stroke="lch(68.75% 3.577 260.65)"
            stroke-width="4"
            stroke-dasharray="12.189379495928398 24.378758991856795"
            stroke-dashoffset="12.189379495928398"
            transform="rotate(-90 7 7)"
          ></circle>
        </svg>
      );
    case 'duplicate':
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn('shrink-0 size-3', className)}>
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke="#95a2b3"
            stroke-width="1.5"
            stroke-dasharray="3.14 0"
            stroke-dashoffset="-0.7"
          ></circle>
          <circle
            cx="7"
            cy="7"
            r="3"
            fill="none"
            stroke="#95a2b3"
            stroke-width="6"
            stroke-dasharray="18.84955592153876 37.69911184307752"
            stroke-dashoffset="0"
            transform="rotate(-90 7 7)"
          ></circle>
          <path
            stroke="none"
            fill-rule="evenodd"
            d="M9.5791 5.71973C9.872 5.42684 10.3468 5.42686 10.6396 5.71973C10.9325 6.01262 10.9325 6.48738 10.6396 6.78027L6.78027 10.6396C6.48738 10.9325 6.01262 10.9325 5.71973 10.6396C5.42686 10.3468 5.42684 9.872 5.71973 9.5791L9.5791 5.71973ZM7.21973 3.36035C7.51261 3.06746 7.98738 3.06747 8.28027 3.36035C8.57315 3.65325 8.57316 4.12801 8.28027 4.4209L4.4209 8.28027C4.12801 8.57316 3.65325 8.57315 3.36035 8.28027C3.06747 7.98738 3.06746 7.51261 3.36035 7.21973L7.21973 3.36035Z"
          ></path>
        </svg>
      );
    case 'triage':
      return (
        <svg
          viewBox="0 0 14 14"
          role="img"
          focusable="false"
          aria-hidden="true"
          className={cn('shrink-0 size-3', className)}
        >
          <path
            fill="lch(66% 80 48)"
            d="M7 14C10.866 14 14 10.866 14 7C14 3.13403 10.866 0 7 0C3.134 0 0 3.13403 0 7C0 10.866 3.134 14 7 14ZM8.0126 9.50781V7.98224H5.9874V9.50787C5.9874 9.92908 5.4767 10.1549 5.14897 9.8786L2.17419 7.37073C1.94194 7.17493 1.94194 6.82513 2.17419 6.62933L5.14897 4.12146C5.4767 3.84515 5.9874 4.07098 5.9874 4.49219V6.01764H8.0126V4.49213C8.0126 4.07092 8.5233 3.84509 8.85103 4.1214L11.8258 6.62927C12.0581 6.82507 12.0581 7.17487 11.8258 7.37067L8.85103 9.87854C8.5233 10.1548 8.0126 9.92902 8.0126 9.50781Z"
          ></path>
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className={cn(
            'size-3 text-foreground-tertiary-muted hover:text-foreground-tertiary shrink-0',
            className
          )}
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}

export function toIssueStatus(raw: string | undefined): IssueStatus {
  if (!raw) return 'todo';
  const s = raw.toLowerCase().trim();
  if (s === 'done' || s === 'closed' || s === 'completed' || s === 'resolved' || s === 'fixed') {
    return 'done';
  }
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === "won't do" ||
    s === "won't fix" ||
    s === 'declined' ||
    s === 'rejected'
  ) {
    return 'cancelled';
  }
  if (
    s === 'in progress' ||
    s === 'in development' ||
    s === 'in_progress' ||
    s === 'open' ||
    s === 'opened'
  ) {
    return 'in_progress';
  }
  if (s === 'review' || s === 'in review' || s === 'code review' || s === 'pr review') {
    return 'review';
  }
  if (s === 'backlog') {
    return 'backlog';
  }
  if (s === 'triage' || s === 'needs triage') {
    return 'triage';
  }
  if (s === 'duplicate') {
    return 'duplicate';
  }
  if (s === 'todo' || s === 'to do' || s === 'to-do' || s === 'not started') {
    return 'todo';
  }

  return 'todo';
}
