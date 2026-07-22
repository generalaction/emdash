const CONTENT_FOCUS_SELECTOR = 'textarea, webview, [contenteditable="true"]';

export function focusActiveContentElement(container: HTMLElement): void {
  for (const element of container.querySelectorAll<HTMLElement>(CONTENT_FOCUS_SELECTOR)) {
    element.focus({ preventScroll: true });
    if (document.activeElement === element) return;
  }
}
