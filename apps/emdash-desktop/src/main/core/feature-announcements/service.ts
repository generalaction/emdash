import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import semver from 'semver';
import * as toml from 'smol-toml';
import { resolveAppVersion } from '@main/core/app/utils';
import { log } from '@main/lib/logger';
import {
  FEATURE_ANNOUNCEMENT_MANIFEST_FILENAME,
  FEATURE_ANNOUNCEMENT_MANIFEST_URL,
} from '@shared/feature-announcements/constants';
import {
  parseFeatureAnnouncementManifest,
  parseFeatureAnnouncementManifestRaw,
  type FeatureAnnouncementManifest,
} from '@shared/feature-announcements/schema';

const MANIFEST_CACHE_TTL_MS = 15 * 60 * 1000;

type CachedManifest = {
  fetchedAt: number;
  manifest: FeatureAnnouncementManifest | null;
};

class FeatureAnnouncementsService {
  private cache: CachedManifest | null = null;

  async getCurrent(): Promise<FeatureAnnouncementManifest | null> {
    const manifest = await this.loadManifest();
    if (!manifest) return null;

    if (manifest.minAppVersion) {
      const currentVersion = await resolveAppVersion();
      const min = semver.coerce(manifest.minAppVersion);
      const current = semver.coerce(currentVersion);
      if (min && current && semver.lt(current, min)) {
        return null;
      }
    }

    return manifest;
  }

  async preview(): Promise<FeatureAnnouncementManifest | null> {
    const content = await this.readManifestContent();
    if (!content) return null;

    try {
      return parseFeatureAnnouncementManifestRaw(toml.parse(content));
    } catch (error) {
      log.warn('[feature-announcements] Failed to parse preview manifest', error);
      return null;
    }
  }

  private async loadManifest(options?: {
    bypassCache?: boolean;
  }): Promise<FeatureAnnouncementManifest | null> {
    if (
      !options?.bypassCache &&
      this.cache &&
      Date.now() - this.cache.fetchedAt < MANIFEST_CACHE_TTL_MS
    ) {
      return this.cache.manifest;
    }

    const content = await this.readManifestContent();
    if (!content) {
      this.cache = { fetchedAt: Date.now(), manifest: null };
      return null;
    }

    try {
      const parsed = parseFeatureAnnouncementManifest(toml.parse(content));
      this.cache = { fetchedAt: Date.now(), manifest: parsed };
      return parsed;
    } catch (error) {
      log.warn('[feature-announcements] Failed to parse manifest', error);
      this.cache = { fetchedAt: Date.now(), manifest: null };
      return null;
    }
  }

  private async readManifestContent(): Promise<string | null> {
    if (import.meta.env.DEV) {
      try {
        const localPath = join(app.getAppPath(), FEATURE_ANNOUNCEMENT_MANIFEST_FILENAME);
        return await readFile(localPath, 'utf8');
      } catch (error) {
        log.debug(
          '[feature-announcements] Local manifest unavailable, falling back to remote',
          error
        );
      }
    }

    try {
      const response = await fetch(FEATURE_ANNOUNCEMENT_MANIFEST_URL, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        log.warn('[feature-announcements] Remote manifest request failed', {
          status: response.status,
        });
        return null;
      }
      return await response.text();
    } catch (error) {
      log.warn('[feature-announcements] Remote manifest fetch failed', error);
      return null;
    }
  }
}

export const featureAnnouncementsService = new FeatureAnnouncementsService();
