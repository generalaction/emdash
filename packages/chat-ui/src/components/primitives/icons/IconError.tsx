/** Error: stroke circle with an X, used on tool-call rows with status === 'error'. */
export function IconError() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="6" />
      <path d="M5 5l4 4M9 5l-4 4" stroke-linecap="round" />
    </svg>
  );
}
