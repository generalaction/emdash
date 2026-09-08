import {
  SURFACE_LEVELS,
  SURFACE_ROLES,
  SURFACE_SCOPES,
  SURFACE_TONES,
  tokens,
} from '@emdash/theme';
import type { SurfaceLevelName, SurfaceScopeName, SurfaceToneName } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react';
import React, { useState } from 'react';
import { Alert } from '../primitives/alert';
import { Button } from '../primitives/button';
import { Icon } from '../primitives/icon';
import { Input } from '../primitives/input';
import { Select } from '../primitives/select';
import { Surface } from '../primitives/surface/surface';
import { Toggle } from '../primitives/toggle';
import { StoryThemeScope } from '../story-theme';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Examples/Surface Cascade',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

function surfaceScopeTokens(scope: SurfaceScopeName) {
  return scope === 'paper' ? tokens.surface.role.paper : tokens.surface.level[scope];
}

function toneScopeTokens(tone: SurfaceToneName, scope: SurfaceScopeName) {
  const toneTokens = tokens.surface.tone[tone];
  if (scope === 'base') return toneTokens;
  if (scope === 'paper') return toneTokens.role.paper;
  return toneTokens.level[scope];
}

/** Base / hover / selected Token swatches for one Surface scope. */
function ElevationSwatch({ level, label }: { level: SurfaceScopeName; label: string }) {
  const isEmphasis = level === 'raised' || level === 'overlay';
  const levelTokens = surfaceScopeTokens(level);
  return (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step1_5,
      })}
    >
      <p className={cx(sx({ fontFamily: 'mono', color: 'foreground' }), s.text10px)}>{label}</p>
      <div
        className={cx(
          s.h10,
          sx({
            width: 'full',
            borderRadius: tokens.radius.sm,
            borderWidth: '1',
            borderStyle: 'solid',
            borderColor: 'border',
          })
        )}
        style={{ background: levelTokens.background }}
        title={`tokens.surface.${level === 'paper' ? 'role.paper' : `level.${level}`}.background`}
      />
      <div
        className={cx(s.h6, sx({ width: 'full', borderRadius: tokens.radius.sm }))}
        style={{ background: levelTokens.hover }}
        title={`tokens.surface.${level === 'paper' ? 'role.paper' : `level.${level}`}.hover`}
      />
      <div
        className={cx(s.h6, sx({ width: 'full', borderRadius: tokens.radius.sm }))}
        style={{
          background: levelTokens.selected,
          boxShadow: isEmphasis ? `inset 0 0 0 1px ${tokens.border.focus}` : undefined,
        }}
        title={`tokens.surface.${level === 'paper' ? 'role.paper' : `level.${level}`}.selected`}
      />
    </div>
  );
}

function SurfaceCard({ level }: { level: SurfaceLevelName }) {
  return (
    <div
      className={cx(
        surface({ level }),
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.step3,
          borderRadius: tokens.radius.lg,
          borderWidth: '1',
          borderStyle: 'solid',
          borderColor: 'border',
          p: tokens.space.step4,
        })
      )}
    >
      <p className={cx(sx({ fontFamily: 'mono', fontSize: 'xs', color: 'foregroundMuted' }))}>
        surface level: {level}
      </p>
      <Input placeholder="Search…" />
      <div className={sx({ display: 'flex', gap: tokens.space.step2 })}>
        <Button variant="ghost" size="base">
          Ghost
        </Button>
        <Button variant="primary" size="base">
          Primary
        </Button>
      </div>
      <Select.Root>
        <Select.Trigger className={cx(sx({ width: 'full' }))}>
          <Select.Value placeholder="Pick one…" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="a">Option A</Select.Item>
          <Select.Item value="b">Option B</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  );
}

function SurfaceTabs({ scope }: { scope: SurfaceScopeName }) {
  const [active, setActive] = useState('first');
  const surfaceProps =
    scope === 'paper' ? ({ role: 'paper' } as const) : ({ level: scope } as const);
  const tabs = [
    { id: 'first', label: 'First' },
    { id: 'second', label: 'Second' },
    { id: 'third', label: 'Third' },
  ];
  return (
    <Surface
      {...surfaceProps}
      className={cx(
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.step0,
          borderRadius: tokens.radius.lg,
          borderWidth: '1',
          borderStyle: 'solid',
          borderColor: 'border',
        })
      )}
    >
      <div
        className={sx({
          background: tokens.surface.current.background,
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space.step1,
          borderBottomWidth: '1',
          borderStyle: 'solid',
          borderColor: 'border',
          px: tokens.space.step1,
          paddingTop: tokens.space.step1,
        })}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-active={active === tab.id ? 'true' : undefined}
            onClick={() => setActive(tab.id)}
            className={s.storyTabButton}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className={cx(
          surface({ emphasis: true }),
          sx({
            borderBottomLeftRadius: tokens.radius.lg,
            borderBottomRightRadius: tokens.radius.lg,
            p: tokens.space.step4,
          })
        )}
      >
        <p className={cx(sx({ fontSize: 'sm', color: 'foregroundMuted' }))}>
          Content for <strong className={cx(sx({ color: 'foreground' }))}>{active}</strong> tab on{' '}
          <code className={cx(sx({ fontFamily: 'mono', fontSize: 'xs' }))}>{scope}</code>
        </p>
      </div>
    </Surface>
  );
}

function SurfaceButtons({ level }: { level: SurfaceLevelName }) {
  return (
    <Surface
      level={level}
      className={cx(
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.step2,
          borderRadius: tokens.radius.lg,
          borderWidth: '1',
          borderStyle: 'solid',
          borderColor: 'border',
          p: tokens.space.step4,
        })
      )}
    >
      <p className={cx(sx({ fontFamily: 'mono', fontSize: 'xs', color: 'foregroundMuted' }))}>
        surface level: {level}
      </p>
      <div
        className={sx({
          display: 'flex',
          flexWrap: 'wrap',
          gap: tokens.space.step2,
        })}
      >
        <Button variant="ghost">Ghost</Button>
        <Button variant="ghost" tone="destructive">
          Destructive
        </Button>
        <Button variant="ghost" tone="warning">
          Warning
        </Button>
        <Button variant="ghost" tone="info">
          Info
        </Button>
        <Button variant="ghost" tone="success">
          Success
        </Button>
      </div>
      <div
        className={sx({
          display: 'flex',
          flexWrap: 'wrap',
          gap: tokens.space.step2,
        })}
      >
        <Button variant="primary">Primary</Button>
        <Button variant="primary" tone="destructive">
          Primary Destructive
        </Button>
      </div>
    </Surface>
  );
}

/** One swatch per elevation step (base / hover / selected). */
export const Ladder: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step4,
        p: tokens.space.step6,
      })}
    >
      <p className={cx(sx({ fontSize: 'sm', color: 'foregroundMuted' }))}>
        Swatches: base → hover → selected for each elevation.
      </p>
      <div className={cx(s.cols5, sx({ display: 'grid', gap: tokens.space.step4 }))}>
        {SURFACE_LEVELS.map((level) => (
          <ElevationSwatch key={level} level={level} label={level} />
        ))}
      </div>
    </div>
  ),
};

/** Cascade proof: context-relative emphasis on each Surface. */
export const Cascade: Story = {
  render: () => (
    <div
      className={cx(
        s.cols3,
        sx({ display: 'grid', gap: tokens.space.step4, p: tokens.space.step6 })
      )}
    >
      {(['sunken', 'base', 'elevated'] as const).map((level) => (
        <div
          key={level}
          className={cx(
            surface({ level }),
            sx({
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space.step3,
              borderRadius: tokens.radius.xl,
              p: tokens.space.step4,
            })
          )}
        >
          <p className={cx(sx({ fontFamily: 'mono', fontSize: 'xs', color: 'foregroundMuted' }))}>
            surface level: {level}
          </p>
          <div
            className={cx(
              surface({ emphasis: true }),
              sx({ borderRadius: tokens.radius.lg, p: tokens.space.step3 })
            )}
          >
            <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>
              context-relative emphasis
            </p>
            <p className={cx(sx({ marginTop: '1', fontSize: 'sm', color: 'foreground' }))}>
              Card content adapts automatically.
            </p>
          </div>
        </div>
      ))}
    </div>
  ),
};

/** Components (Input, Button, Select) on every surface level. */
export const ComponentsOnAllSurfaces: Story = {
  render: () => (
    <div
      className={cx(
        s.cols2,
        s.lgCols3,
        sx({ display: 'grid', gap: tokens.space.step4, p: tokens.space.step6 })
      )}
    >
      {SURFACE_LEVELS.map((level) => (
        <SurfaceCard key={level} level={level} />
      ))}
    </div>
  ),
};

/** Tab strips demonstrating hover and selected states on each surface. */
export const Tabs: Story = {
  render: () => (
    <div
      className={cx(
        s.cols1,
        s.lgCols2,
        sx({ display: 'grid', gap: tokens.space.step4, p: tokens.space.step6 })
      )}
    >
      {SURFACE_LEVELS.map((level) => (
        <SurfaceTabs key={level} scope={level} />
      ))}
    </div>
  ),
};

/** Buttons demonstrating hover, selected, and destructive across every surface. */
export const Buttons: Story = {
  render: () => (
    <div
      className={cx(
        s.cols1,
        s.lgCols2,
        sx({ display: 'grid', gap: tokens.space.step4, p: tokens.space.step6 })
      )}
    >
      {SURFACE_LEVELS.map((level) => (
        <SurfaceButtons key={level} level={level} />
      ))}
    </div>
  ),
};

const STATUS_ICON: Record<SurfaceToneName, React.ReactNode> = {
  info: <Icon source={InfoIcon} />,
  warning: <Icon source={AlertTriangleIcon} />,
  destructive: <Icon source={AlertCircleIcon} />,
  success: <Icon source={CheckCircle2Icon} />,
};

const STATUS_LABEL: Record<SurfaceToneName, string> = {
  info: 'Info',
  warning: 'Warning',
  destructive: 'Destructive',
  success: 'Success',
};

const STATUS_MESSAGE: Record<SurfaceToneName, string> = {
  info: 'This is an informational message. Ghost controls inside adapt to the tinted surface.',
  warning: 'Something needs your attention. Controls inherit the tinted hover/selected states.',
  destructive: 'This action cannot be undone. All controls respond to the destructive surface.',
  success: 'Operation completed successfully. Controls inherit the tinted hover/selected states.',
};

function StatusRoom({ status }: { status: SurfaceToneName }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step3,
      })}
    >
      <Alert.Root status={status} icon={STATUS_ICON[status]}>
        <strong>{STATUS_LABEL[status]}:</strong> {STATUS_MESSAGE[status]}
      </Alert.Root>
      <div
        className={cx(
          surface({ tone: status }),
          sx({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space.step2,
            borderRadius: tokens.radius.lg,
            borderWidth: '1',
            borderStyle: 'solid',
            borderColor: tokens.surface.current.border,
            p: tokens.space.step3,
          })
        )}
      >
        <span
          className={cx(
            sx({
              flex: '1',
              fontSize: 'sm',
              color: tokens.surface.current.foreground,
            })
          )}
        >
          Controls inside a toned Surface
        </span>
        <Toggle
          pressed={pressed}
          onPressedChange={setPressed}
          className={cx(sx({ flexShrink: 0 }))}
        >
          {pressed ? 'Active' : 'Toggle'}
        </Toggle>
        <Button variant="ghost" tone="neutral">
          Action
        </Button>
        <Button variant="ghost" tone="destructive">
          Delete
        </Button>
      </div>
    </div>
  );
}

/**
 * Surface Tone variants (destructive / warning / info). Each is a tinted
 * "room" — ghost controls inside automatically pick up the tinted hover/selected
 * states from the cascade without any per-component override.
 */
export const ToneSurfaces: Story = {
  render: () => (
    <div
      className={cx(
        s.cols1,
        sx({ display: 'grid', gap: tokens.space.step6, p: tokens.space.step6 })
      )}
    >
      <div>
        <p className={cx(sx({ marginBottom: '1', fontSize: 'sm', color: 'foreground' }))}>
          Surface Tones — tinted regions using inherited context
        </p>
        <p className={cx(sx({ fontSize: 'xs', color: 'foregroundMuted' }))}>
          Each status box rebinds{' '}
          <code className={cx(sx({ fontFamily: 'mono' }))}>tokens.surface.current.hover</code> and{' '}
          <code className={cx(sx({ fontFamily: 'mono' }))}>tokens.surface.current.selected</code> so
          any ghost Button / Toggle inside already hovers/selects with the correct tint.
        </p>
      </div>
      {SURFACE_TONES.map((status) => (
        <StatusRoom key={status} status={status} />
      ))}
      <div>
        <p
          className={cx(
            sx({
              marginBottom: '3',
              fontSize: 'sm',
              color: 'foregroundMuted',
            })
          )}
        >
          Swatches — base / hover / selected per status
        </p>
        <div className={cx(s.cols3, sx({ display: 'grid', gap: tokens.space.step4 }))}>
          {SURFACE_TONES.map((status) => (
            <div
              key={status}
              className={sx({
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.space.step1_5,
              })}
            >
              <p className={cx(sx({ fontFamily: 'mono', color: 'foreground' }), s.text10px)}>
                {status}
              </p>
              <div
                className={cx(
                  s.h10,
                  sx({
                    width: 'full',
                    borderRadius: tokens.radius.sm,
                    borderWidth: '1',
                    borderStyle: 'solid',
                  })
                )}
                style={{
                  background: tokens.surface.tone[status].background,
                  borderColor: tokens.surface.tone[status].border,
                }}
                title={`tokens.surface.tone.${status}.background`}
              />
              <div
                className={cx(s.h6, sx({ width: 'full', borderRadius: tokens.radius.sm }))}
                style={{ background: tokens.surface.tone[status].hover }}
                title={`tokens.surface.tone.${status}.hover`}
              />
              <div
                className={cx(s.h6, sx({ width: 'full', borderRadius: tokens.radius.sm }))}
                style={{ background: tokens.surface.tone[status].selected }}
                title={`tokens.surface.tone.${status}.selected`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};

function PaperRoom() {
  return (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step6,
        background: tokens.palette.neutral.step1,
        p: tokens.space.step6,
      })}
    >
      <div>
        <p className={cx(sx({ fontSize: 'sm', color: 'foreground' }))}>
          Paper — primary content / tab background
        </p>
        <p
          className={cx(
            sx({ marginTop: '1', fontSize: 'xs', color: 'foregroundMuted' }),
            s.maxWProse
          )}
        >
          White-ish in light mode (matches{' '}
          <code className={cx(sx({ fontFamily: 'mono' }))}>elevated</code>) and flat with{' '}
          <code className={cx(sx({ fontFamily: 'mono' }))}>base</code> in dark mode. Use it for the
          surface tabbed content sits on. Cards/tabs on paper use{' '}
          <code className={cx(sx({ fontFamily: 'mono' }))}>raised</code>.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '12rem 1fr', gap: '1.5rem' }}>
        <div
          className={sx({
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space.step4,
          })}
        >
          {SURFACE_ROLES.map((role) => (
            <ElevationSwatch key={role} level={role} label={role} />
          ))}
        </div>
        <SurfaceTabs scope="paper" />
      </div>
    </div>
  );
}

/**
 * The `paper` surface role. Because it is white in light but base-gray in dark,
 * it is best understood side-by-side.
 */
export const Paper: Story = {
  render: () => (
    <div className={cx(s.minHScreen, sx({ display: 'flex' }))}>
      <StoryThemeScope colorScheme="light" className={cx(sx({ flex: '1' }))}>
        <PaperRoom />
      </StoryThemeScope>
      <StoryThemeScope colorScheme="dark" className={cx(sx({ flex: '1' }))}>
        <PaperRoom />
      </StoryThemeScope>
    </div>
  ),
};

/**
 * Status × Elevation matrix.
 *
 * Each cell renders a status room on a given elevation scope so you can
 * visually verify that the generated per-level tints track the canvas lightness
 * correctly. In dark mode each row should get progressively lighter left-to-right;
 * in light mode they should get slightly darker. The x1.0 track_delta is the
 * baseline — tune the shift multiplier in resolve.ts if rooms wash out.
 */
export const StatusLevelMatrix: Story = {
  render: () => (
    <div className={cx(s.minHScreen, sx({ display: 'flex' }))}>
      {(['light', 'dark'] as const).map((theme) => (
        <StoryThemeScope
          key={theme}
          colorScheme={theme}
          className={cx(sx({ flex: '1', p: tokens.space.step4 }))}
        >
          <div
            className={sx({
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space.step4,
              background: tokens.palette.neutral.step1,
              p: tokens.space.step4,
            })}
          >
            <p
              className={cx(
                sx({
                  fontSize: 'sm',
                  color: 'foreground',
                  marginBottom: '3',
                })
              )}
            >
              {theme} — status × elevation
            </p>
            {SURFACE_TONES.map((status) => (
              <div
                key={status}
                className={sx({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space.step4,
                })}
              >
                <p
                  className={cx(
                    sx({ fontFamily: 'mono', fontSize: 'xs', color: 'foregroundMuted' })
                  )}
                >
                  {status}
                </p>
                <div
                  className={sx({ display: 'grid', gap: tokens.space.step2 })}
                  style={{
                    gridTemplateColumns: `repeat(${SURFACE_SCOPES.length}, minmax(0, 1fr))`,
                  }}
                >
                  {SURFACE_SCOPES.map((scope) => {
                    const scopeTokens = toneScopeTokens(status, scope);
                    return (
                      <div
                        key={scope}
                        className={sx({
                          display: 'flex',
                          flexDirection: 'column',
                          gap: tokens.space.step1_5,
                        })}
                      >
                        <p className={cx(sx({ fontFamily: 'mono' }), s.text10px)}>{scope}</p>
                        <div
                          className={cx(
                            s.h10,
                            sx({
                              width: 'full',
                              borderRadius: tokens.radius.sm,
                              borderWidth: '1',
                              borderStyle: 'solid',
                            })
                          )}
                          style={{
                            background: scopeTokens.background,
                            borderColor: scopeTokens.border,
                          }}
                          title={`tokens.surface.tone.${status}.${scope}.background`}
                        />
                        <div
                          className={cx(
                            s.h6,
                            sx({ width: 'full', borderRadius: tokens.radius.sm })
                          )}
                          style={{ background: scopeTokens.hover }}
                          title={`tokens.surface.tone.${status}.${scope}.hover`}
                        />
                        <div
                          className={cx(
                            s.h6,
                            sx({ width: 'full', borderRadius: tokens.radius.sm })
                          )}
                          style={{ background: scopeTokens.selected }}
                          title={`tokens.surface.tone.${status}.${scope}.selected`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </StoryThemeScope>
      ))}
    </div>
  ),
};

/** Light and dark modes side-by-side. */
export const BothModes: Story = {
  render: () => (
    <div className={cx(s.minHScreen, sx({ display: 'flex' }))}>
      <StoryThemeScope
        colorScheme="light"
        className={cx(
          sx({
            display: 'flex',
            flex: '1',
            flexDirection: 'column',
            gap: tokens.space.step6,
            background: tokens.palette.neutral.step1,
            p: tokens.space.step6,
          })
        )}
      >
        <p className={cx(sx({ fontSize: 'sm', color: 'foreground' }))}>Light mode</p>
        <div className={cx(s.cols3, sx({ display: 'grid', gap: tokens.space.step4 }))}>
          {SURFACE_LEVELS.map((level) => (
            <ElevationSwatch key={level} level={level} label={level} />
          ))}
        </div>
        <div className={cx(s.cols2, sx({ display: 'grid', gap: tokens.space.step3 }))}>
          {SURFACE_LEVELS.map((level) => (
            <SurfaceCard key={level} level={level} />
          ))}
        </div>
      </StoryThemeScope>
      <StoryThemeScope
        colorScheme="dark"
        className={cx(
          s.borderLeft,
          sx({
            display: 'flex',
            flex: '1',
            flexDirection: 'column',
            gap: tokens.space.step6,
            background: tokens.palette.neutral.step1,
            p: tokens.space.step6,
          })
        )}
      >
        <p className={cx(sx({ fontSize: 'sm', color: 'foreground' }))}>Dark mode</p>
        <div className={cx(s.cols3, sx({ display: 'grid', gap: tokens.space.step4 }))}>
          {SURFACE_LEVELS.map((level) => (
            <ElevationSwatch key={level} level={level} label={level} />
          ))}
        </div>
        <div className={cx(s.cols2, sx({ display: 'grid', gap: tokens.space.step3 }))}>
          {SURFACE_LEVELS.map((level) => (
            <SurfaceCard key={level} level={level} />
          ))}
        </div>
      </StoryThemeScope>
    </div>
  ),
};
