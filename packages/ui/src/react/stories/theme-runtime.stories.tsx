import { tokens } from '@emdash/theme';
import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
  type ColorSchemeId,
  type DensityId,
  type TypographyId,
} from '@emdash/theme/profiles';
import { resolveTheme, type ThemeProfileIds } from '@emdash/theme/runtime';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { useMemo, useState } from 'react';
import { ThemeProvider } from '../theme-runtime';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Theme/Controlled full-profile runtime',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

const COLD_PROFILE_IDS: ThemeProfileIds = {
  colorScheme: 'light',
  density: 'comfortable',
  typography: 'default',
};

function RuntimeExample() {
  const [profileIds, setProfileIds] = useState<ThemeProfileIds>(COLD_PROFILE_IDS);
  const theme = useMemo(() => resolveTheme(profileIds), [profileIds]);

  function updateProfile<Dimension extends keyof ThemeProfileIds>(
    dimension: Dimension,
    id: ThemeProfileIds[Dimension]
  ) {
    setProfileIds((current) => ({ ...current, [dimension]: id }));
  }

  return (
    <ThemeProvider
      theme={theme}
      target="subtree"
      as="section"
      className={cx(
        s.maxWProse,
        sx({
          display: 'grid',
          gap: tokens.space.step4,
          p: tokens.space.step6,
          color: tokens.foreground.default,
          background: tokens.surface.current.background,
          borderWidth: '1',
          borderStyle: 'solid',
          borderColor: tokens.border.default,
          borderRadius: tokens.radius.lg,
          fontFamily: 'sans',
        })
      )}
    >
      <div>
        <strong>Cold Theme resolution</strong>
        <div>
          {COLD_PROFILE_IDS.colorScheme} / {COLD_PROFILE_IDS.density} /{' '}
          {COLD_PROFILE_IDS.typography}
        </div>
      </div>

      <label>
        Color scheme{' '}
        <select
          value={profileIds.colorScheme}
          onChange={(event) =>
            updateProfile('colorScheme', event.currentTarget.value as ColorSchemeId)
          }
        >
          {COLOR_SCHEME_MANIFEST.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Density{' '}
        <select
          value={profileIds.density}
          onChange={(event) => updateProfile('density', event.currentTarget.value as DensityId)}
        >
          {DENSITY_MANIFEST.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Typography{' '}
        <select
          value={profileIds.typography}
          onChange={(event) =>
            updateProfile('typography', event.currentTarget.value as TypographyId)
          }
        >
          {TYPOGRAPHY_MANIFEST.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>

      <output>
        Runtime classes: <code>{theme.classNames.join(' ')}</code>
      </output>
    </ThemeProvider>
  );
}

/** Cold resolution plus controlled runtime changes for every profile dimension. */
export const ProfileControls: Story = {
  render: () => <RuntimeExample />,
};
