import { CONTENT_FOCUS_REQUEST_EVENT } from '@emdash/ui/react/components';

const CONTENT_FOCUS_SELECTOR = 'textarea, webview, [contenteditable="true"]';

export function focusActiveContentElement(container: HTMLElement): void {
  for (const element of container.querySelectorAll<HTMLElement>(CONTENT_FOCUS_SELECTOR)) {
    const focusRequest = new Event(CONTENT_FOCUS_REQUEST_EVENT, {
      bubbles: true,
      cancelable: true,
    });
    if (!element.dispatchEvent(focusRequest)) {
      if (element.contains(document.activeElement)) return;
      continue;
    }

    element.focus();
    if (document.activeElement === element) return;
  }
}
