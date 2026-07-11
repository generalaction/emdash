import { app, session, type Session } from 'electron';
import { log } from '@main/lib/logger';
import type { AppSettings } from '@shared/core/app-settings';
import {
  applyLocalDevelopmentCorsRelaxation,
  localDevelopmentCorsRelaxationRequest,
  type BrowserCorsRelaxationRequest,
} from './browser-cors-relaxation';
import {
  firefoxUserAgent,
  isGoogleAuthUrl,
  stripEmbeddedBrowserTokens,
} from './browser-user-agent';

// Web permissions the embedded browser may use without asking. Everything else
// (camera, microphone, geolocation, notifications, USB/HID/serial, …) is denied:
// the in-app browser holds logged-in sessions and must not become a side channel
// into device capabilities (Electron security checklist #5).
const ALLOWED_BROWSER_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
]);

const configuredPartitions = new Set<string>();
const verificationOrigins = new Map<string, string>();
const retiredVerificationPartitions = new Set<string>();
const MAX_RETIRED_VERIFICATION_PARTITIONS = 256;
let relaxCorsForLocalDevelopment = false;

export function setBrowserCorsRelaxationSettings(browser: AppSettings['browser']): void {
  relaxCorsForLocalDevelopment = browser.relaxCorsForLocalhost;
}

/**
 * Returns the session for a browser partition, applying profile-wide hardening
 * exactly once per partition: deny-by-default permissions, an embedded-browser
 * user agent without Electron tokens, and a Firefox user agent on Google auth
 * hosts so third-party "Sign in with Google" flows are not rejected.
 */
export function configureBrowserProfileSession(partition: string): Session {
  const ses = session.fromPartition(partition);
  if (retiredVerificationPartitions.has(partition)) return ses;
  if (configuredPartitions.has(partition)) return ses;
  configuredPartitions.add(partition);

  ses.setUserAgent(stripEmbeddedBrowserTokens(ses.getUserAgent(), app.getName()));

  const corsRequests = new Map<number, BrowserCorsRelaxationRequest>();

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (isGoogleAuthUrl(details.url)) {
      details.requestHeaders['User-Agent'] = firefoxUserAgent();
    }

    const corsRequest = relaxCorsForLocalDevelopment
      ? localDevelopmentCorsRelaxationRequest(details.requestHeaders)
      : null;
    if (corsRequest) corsRequests.set(details.id, corsRequest);
    else corsRequests.delete(details.id);

    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const corsRequest = corsRequests.get(details.id);
    corsRequests.delete(details.id);
    if (!relaxCorsForLocalDevelopment || !corsRequest || !details.responseHeaders) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: applyLocalDevelopmentCorsRelaxation(details.responseHeaders, corsRequest),
    });
  });

  ses.webRequest.onCompleted((details) => {
    corsRequests.delete(details.id);
  });
  ses.webRequest.onErrorOccurred((details) => {
    corsRequests.delete(details.id);
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const granted = ALLOWED_BROWSER_PERMISSIONS.has(permission);
    if (!granted) {
      log.debug('Denied browser permission request', { permission });
    }
    callback(granted);
  });
  ses.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_BROWSER_PERMISSIONS.has(permission)
  );

  return ses;
}

/**
 * Configures a disposable Loop verification partition before its webview is mounted.
 * Verification partitions never receive page permissions, and top-level or subframe
 * navigation cannot leave the immutable preview origin.
 */
export function configureBrowserVerificationSession(
  partition: string,
  allowedOrigin: string
): boolean {
  if (!isExactHttpOrigin(allowedOrigin)) return false;
  if (retiredVerificationPartitions.has(partition)) return false;
  const existing = verificationOrigins.get(partition);
  if (existing !== undefined) return existing === allowedOrigin;

  const ses = configureBrowserProfileSession(partition);
  verificationOrigins.set(partition, allowedOrigin);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const isFrameNavigation =
      details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
    callback({ cancel: isFrameNavigation && !urlMatchesOrigin(details.url, allowedOrigin) });
  });
  return true;
}

export function releaseBrowserVerificationSession(
  partition: string,
  allowedOrigin: string
): boolean {
  if (verificationOrigins.get(partition) !== allowedOrigin) return false;
  const ses = session.fromPartition(partition);
  ses.webRequest.onBeforeRequest(null);
  ses.webRequest.onBeforeSendHeaders(null);
  ses.webRequest.onHeadersReceived(null);
  ses.webRequest.onCompleted(null);
  ses.webRequest.onErrorOccurred(null);
  ses.setPermissionRequestHandler(null);
  ses.setPermissionCheckHandler(null);
  verificationOrigins.delete(partition);
  configuredPartitions.delete(partition);
  retiredVerificationPartitions.add(partition);
  while (retiredVerificationPartitions.size > MAX_RETIRED_VERIFICATION_PARTITIONS) {
    retiredVerificationPartitions.delete(retiredVerificationPartitions.values().next().value!);
  }
  return true;
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function urlMatchesOrigin(value: string, allowedOrigin: string): boolean {
  try {
    return new URL(value).origin === allowedOrigin;
  } catch {
    return false;
  }
}
