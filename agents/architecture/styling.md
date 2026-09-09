# Styling Architecture

Emdash uses one Theme and Token model, one UI stylesheet, and one namespaced cascade across
`@emdash/theme`, `@emdash/ui`, and workspace hosts. This page explains ownership and runtime flow.
For day-to-day authoring rules, use [UI styling conventions](../conventions/ui-styling.md).

## Ownership

`@emdash/theme` owns:

- the literal `tokens` tree and narrow authoring types exported from the package root;
- internal Color scheme, Density, and Typography Profile Definitions;
- internal Theme Compiler validation and generated Token Values;
- public profile ids/manifests from `/profiles` and complete Theme resolution from `/runtime`;
- the generated `@emdash/theme/styles.css` artifact consumed by the UI build.

`@emdash/ui` consumes Theme interfaces and owns:

- shared React components and their Component Styling Interfaces;
- layer-aware `style`, callable-only `recipe`, finite `sx`, and strict `cx`;
- the public `surface`, `control`, `field-control`, and `menu-item` Recipes;
- reset/base rules, shared effects, typography roles, and the self-contained
  `@emdash/ui/styles.css` aggregate.

Each workspace host owns:

- CSS loading order and the stable root it controls;
- Theme preference, persistence, system-policy, and pre-paint resolution;
- one controlled Theme runtime mount;
- product-specific Recipes, vendor imports, foreign-DOM adapters, and imperative integration
  mappings.

There is no UI-local Token map and no host Token palette. Canonical author-facing Token Values use
`--em-*`; private runtime, framework, and foreign-package properties are integration details rather
than Tokens.

## Token and Profile Flow

The literal `tokens` tree in `packages/theme/src/core/tokens.ts` is the authoring and IDE-navigation
surface. Import it from `@emdash/theme` and prefer Semantic or Contextual Tokens when they express
the intent. Palette Tokens remain available for cases where no shared semantic meaning exists.
VCS, diff, workflow, and other product meanings belong to host-owned Recipes, not the shared tree.

Profile Definitions assign Token Values:

1. Color scheme profiles assign color, Surface, selection, and shadow values.
2. Density profiles assign spacing and radius values.
3. Typography profiles assign font families, weights, sizes, and line heights.
4. The Theme Compiler validates each profile against the same literal Token catalog and emits
   `@emdash/theme/styles.css`.
5. Public manifests in `@emdash/theme/profiles` provide supported ids, labels, and selectors.
6. `resolveTheme()` from `@emdash/theme/runtime` resolves one profile from every dimension into a
   complete Theme and its three class names.

Hosts use the same manifest-derived data before and after React starts. Bootstrap applies all three
classes before paint; the controlled `ThemeProvider` from `@emdash/ui/react/theme-runtime`
reconciles that set and becomes the sole runtime writer. It loads no CSS and owns no preference,
persistence, defaulting, or system-policy state.

## CSS Loading

Every host has one aggregate entry with this order:

```css
@import '@emdash/ui/styles.css';
@import './vendor.css';
@import './host.css';
```

The UI stylesheet is imported exactly once and before host CSS. TypeScript and React modules never
load CSS as a side effect. `@emdash/ui/styles.css` already contains generated Theme values,
reset/base rules, all UI component styles, Recipes, Utilities, effects, font faces, and packaged
assets; hosts do not separately import Theme CSS.

Vendor CSS is host-selected and loaded with `layer(emdash.vendor)`. Host-authored CSS belongs to
`emdash.host`. Desktop's concrete aggregate is `apps/emdash-desktop/src/renderer/styles.css`, with
vendor imports in `vendor.css` and host rules in `index.css`. Tailwind directive sources such as
`tw-animate-css` also live in `vendor.css`, but their top-level `@utility` definitions cannot be
wrapped by an import layer; Tailwind emits their generated utilities at the configured host
insertion point.

## Cascade Layers

The aggregate declares the complete order before any layer content:

`emdash.vendor < emdash.reset < emdash.tokens < emdash.base < emdash.recipes < emdash.utilities < emdash.host`

- `vendor`: third-party and separately packaged CSS selected by the host;
- `reset`: normalization and framework preflight;
- `tokens`: generated Profile Token Values;
- `base`: shared document and element defaults;
- `recipes`: shared component styles, Recipes, and rooted shared adapters;
- `utilities`: intentional caller overrides from `sx`;
- `host`: host-owned product Recipes, adapters, Tailwind output, and document rules.

Authors do not choose a layer. Public wrappers place output automatically. All Emdash cascade
declarations are layered; only non-cascade constructs such as keyframes and font faces may be
top-level. Higher layers do not waive property ownership: a Utility override explicitly transfers
that property to the caller, while competing Recipes indicate a missing variant or ownership bug.

## Surface

A Surface is a rendered region that establishes inherited background, foreground, border, and
interaction-state context. The public `surface()` Recipe and `<Surface>` component share one
implementation and expose four orthogonal axes:

- `level`: `sunken`, `base`, `raised`, `elevated`, or `overlay`;
- `role`: currently `paper`;
- `tone`: `destructive`, `warning`, `info`, or `success`;
- `emphasis`: a context-relative emphasized region.

At least one axis is required; omitted axes inherit. Descendants should consume
`tokens.surface.current.*` so they adapt to the nearest Surface. Use an ordinary element if no
context should be established. Popup shells choose their Surface internally; callers should not
stack another Surface on an owned overlay root.

## Host Styling Adapters

The restricted `@emdash/ui/styles/host` entry is available only to registered host-owned adapter
modules. It provides:

- `hostStyle()` and `hostRecipe()` for `emdash.host`;
- `hostAdapter()` for selectors contained below one generated root;
- `defineIntegrationManifest()` for checked CSS-to-imperative mappings.

Desktop installs one owned document marker and aggregates feature contributions in
`src/core/manifests/browser/host-style-contributions.ts`. Product Recipes stay with their vertical
slice and are exported only through that slice's contribution. Do not invent `hostTokens`, expose
private custom properties to ordinary authors, or move product meanings into `@emdash/theme`.

Tailwind is temporary host infrastructure. Its `--color-*` targets map directly to `--em-*` and do
not form another palette.

## Foreign DOM, Icons, and Integrations

Owned SVG sources use `<Icon source={StaticSvgComponent}>`, which applies geometry directly to the
SVG and inherits `currentColor`. Opaque caller content uses `<IconSlot>`, whose rooted adapter sizes
only a direct-child SVG. Devicon glyphs, plugin assets, Markdown, Mermaid, images, and generated
diagrams retain source-specific rooted adapters.

Global Rules are reserved for Theme/reset/base infrastructure or a declared adapter around DOM that
cannot receive an owned class. Shared adapters live in `*.adapter.css.ts` modules registered in
`tooling/oxlint/registries/global-adapters.json`; desktop adapters use the host API and are
registered in `host-adapters.json`.

Package and imperative boundaries stay explicit:

- `--chat-*` is the Chat UI package contract; each host maps it to canonical Tokens.
- Monaco and Xterm use typed integration manifests. One field map generates private declarations
  and the computed-style reader, so runtime code does not embed CSS property names.
- Framework-written geometry properties remain private and must be documented as external
  constraints rather than promoted to Tokens.

## Debugging

Debug styling from ownership outward:

1. Inspect the element and identify its owning component, Recipe, Utility, or adapter.
2. Check the active Color scheme, Density, and Typography classes on the Theme scope.
3. Trace an authored reference through `tokens.*`; inspect the resolved `--em-*` value only after
   confirming the intended Token and nearest Surface.
4. Check the winning cascade layer. Unexpected `utilities` usually means caller `sx`; unexpected
   `host` means a Host Adapter or Tailwind rule.
5. For a contextual value, walk ancestors to the nearest Surface and verify its selected axes.
6. For foreign DOM, verify the registered adapter root contains the generated markup.
7. For Monaco/Xterm, compare the integration manifest fields, generated private declarations, and
   imperative reader output.
8. If source looks correct but the asset is missing, run the UI build and inspect its sentinels,
   unresolved-import report, and stylesheet/font budgets.

Do not repair cascade problems with selector duplication, an unlayered rule, compatibility aliases,
or a second stylesheet. Fix the owner, expose a semantic variant/slot, or use a deliberate `sx`
override on the documented root.
