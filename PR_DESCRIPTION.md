# Add Cline CLI Provider Support

## Summary
This PR adds Cline CLI as a new AI coding agent provider option in Emdash. Cline CLI runs AI coding agents directly in the terminal and supports multiple model providers, enabling users to choose Cline alongside existing providers like Codex, Claude Code, and others.

## Changes Made

### Core Provider Integration
- **Provider Registry** (`src/shared/providers/registry.ts`)
  - Added `'cline'` to `PROVIDER_IDS` array
  - Added Cline provider definition with:
    - Installation command: `npm install -g cline`
    - Documentation URL: `https://docs.cline.bot/cline-cli/overview`
    - CLI command: `cline`
    - Version detection: Uses `help` subcommand (Cline doesn't support `--version`)

### UI Components
- **Provider Selectors**: Updated all provider selector components to include Cline:
  - `ProviderSelector.tsx` - Single provider dropdown
  - `MultiProviderSelector.tsx` - Multi-provider grid selector
  - `MultiProviderMenu.tsx` - Multi-provider menu dropdown
- **Provider Bar** (`ProviderBar.tsx`): Added Cline logo and configuration
- **Provider Info Card** (`ProviderInfoCard.tsx`): Added Cline description and metadata

### Assets & Metadata
- **Provider Assets** (`src/renderer/providers/assets.ts`): Added Cline logo import and asset configuration
- **Provider Meta** (`src/renderer/providers/meta.ts`): Added Cline metadata (CLI command, icon path, terminal-only flag)
- **Logo**: Added `src/assets/images/cline.png` logo file

### Type Definitions
- **Workspace Metadata** (`src/renderer/types/chat.ts`): Added `'cline'` to all provider union types:
  - `multiAgent.providers` array type
  - `multiAgent.variants[].provider` type
  - `multiAgent.selectedProvider` type

## Technical Details

### Version Detection
Cline CLI doesn't support the standard `--version` flag. Instead, we use the `help` subcommand (`cline help`) for detection, which:
- Exits with code 0 (success)
- Outputs help text that can be parsed
- Allows proper detection of installed Cline instances

This follows the same pattern used for other CLIs that don't support `--version` (e.g., Kimi uses `--help`).

## Testing
- [x] Type checking passes (`npm run type-check`)
- [x] Linting passes (`npm run lint`)
- [x] Cline logo displays correctly in provider selectors
- [x] Cline appears in all provider selection UIs
- [x] Version detection works with `cline help` command
- [x] Cline can be selected and started in terminal

## Documentation
- Provider documentation URL: https://docs.cline.bot/cline-cli/overview
- Installation command displayed in provider info cards
- Description explains Cline's multi-provider model support

## Related
- Follows the same integration pattern as other CLI providers
- Maintains consistency with existing provider configuration structure
- No breaking changes to existing functionality
