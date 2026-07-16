export type MobileCryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
};

export type MobileClipboardSource = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

export type MobileClipboardEnvironment = {
  clipboard?: MobileClipboardSource;
  copyText?: (text: string) => boolean;
  prompt?: (message: string, defaultValue?: string) => string | null;
};

function browserCrypto(): MobileCryptoSource | undefined {
  if (typeof globalThis.crypto === 'undefined') return undefined;
  const source = globalThis.crypto;
  return {
    ...(typeof source.randomUUID === 'function' ? { randomUUID: () => source.randomUUID() } : {}),
    getRandomValues: (values) => source.getRandomValues(values),
  };
}

/**
 * `crypto.randomUUID()` is restricted to secure contexts in mobile browsers, while
 * `crypto.getRandomValues()` remains available on the private HTTP origin used by v1.
 */
export function createMobileUuid(
  source: MobileCryptoSource | null | undefined = browserCrypto(),
  random: () => number = Math.random
): string {
  if (typeof source?.randomUUID === 'function') {
    try {
      return source.randomUUID();
    } catch {
      // Fall through when a browser exposes the method but blocks it on an HTTP origin.
    }
  }

  const bytes = new Uint8Array(16);
  let generatedSecurely = false;
  if (typeof source?.getRandomValues === 'function') {
    try {
      source.getRandomValues(bytes);
      generatedSecurely = true;
    } catch {
      // Request and attachment IDs are not authentication secrets, so a UUID-shaped
      // Math.random fallback is preferable to making the mobile UI unusable.
    }
  }
  if (!generatedSecurely) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(random() * 256) & 0xff;
    }
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readMobileClipboard(
  environment: MobileClipboardEnvironment = browserClipboardEnvironment()
): Promise<string> {
  if (typeof environment.clipboard?.readText === 'function') {
    try {
      return await environment.clipboard.readText();
    } catch {
      // Clipboard API access can be denied on an otherwise supported browser.
    }
  }

  try {
    return environment.prompt?.('Paste text to send to the terminal:', '') ?? '';
  } catch {
    return '';
  }
}

export async function writeMobileClipboard(
  text: string,
  environment: MobileClipboardEnvironment = browserClipboardEnvironment()
): Promise<boolean> {
  if (typeof environment.clipboard?.writeText === 'function') {
    try {
      await environment.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the legacy copy command on non-secure or permission-denied origins.
    }
  }

  try {
    if (environment.copyText?.(text)) return true;
  } catch {
    // A manual prompt is the final fallback when the browser blocks scripted copy.
  }

  try {
    environment.prompt?.('Copy this text:', text);
  } catch {
    // Clipboard support is best effort; callers can leave their normal copy affordance visible.
  }
  return false;
}

function browserClipboardEnvironment(): MobileClipboardEnvironment {
  return {
    clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard,
    copyText: copyTextWithDocument,
    prompt:
      typeof window === 'undefined' || typeof window.prompt !== 'function'
        ? undefined
        : (message, defaultValue) => window.prompt(message, defaultValue),
  };
}

function copyTextWithDocument(text: string): boolean {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.execCommand !== 'function'
  ) {
    return false;
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.setAttribute('aria-hidden', 'true');
  input.style.position = 'fixed';
  input.style.inset = '0 auto auto -9999px';
  input.style.fontSize = '16px';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  input.setSelectionRange(0, input.value.length);
  try {
    return document.execCommand('copy');
  } finally {
    input.remove();
  }
}
