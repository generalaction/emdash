# Marketplace

The Marketplace is a top-level destination (alongside Home, Workspaces, Automations,
Settings) where users browse, install, create, and share Skills and Connectors. It
unifies three existing emdash surfaces (Library/Prompts, Skills, MCP management) under
one UI and adds Smithery as a fourth catalog source.

---

## Four Tabs

| Tab | Content source | What it maps to in emdash |
|---|---|---|
| **Skills** | Built-in catalog + installed user skills | `src/renderer/features/skills/` + `src/main/core/skills/` |
| **Connectors** | Built-in MCP catalog (~48 servers) + manually added | `src/renderer/features/mcp/` + `src/main/core/mcp/` |
| **Smithery** | Smithery registry (~6,000+ MCP servers) via API | New integration |
| **My items** | User-created and user-installed items | Aggregate from skills + MCP + automations |

---

## File Layout

Move / create under `src/renderer/features/marketplace/`:

```
src/renderer/features/marketplace/
├── marketplace-view.tsx         — top-level view, tab switcher, search bar
├── skills-tab.tsx               — skills catalog + install (absorbs SkillsView.tsx)
├── connectors-tab.tsx           — MCP catalog + install (absorbs McpView.tsx)
├── smithery-tab.tsx             — Smithery registry browse + install
├── my-items-tab.tsx             — user's installed + created + published items
├── create-skill-modal.tsx       — (move from features/skills/CreateSkillModal.tsx)
├── item-card.tsx                — shared card component (name, description, source badge, public/private badge, actions)
├── item-detail-modal.tsx        — detail view for any marketplace item
├── use-smithery.ts              — hooks for Smithery API calls (via main process)
└── publish-modal.tsx            — visibility toggle + publish confirmation
```

Register `marketplace` as a view in `src/renderer/app/view-registry.ts`. Remove the
separate `library` and `skills` and `mcp` entries from the top-level nav (fold them in).

---

## Skills Tab

**Existing backend (keep as-is):**
- `src/main/core/skills/SkillsService.ts` — getCatalog, refreshCatalog, searchSkillSh, install, uninstall, create
- `src/main/core/skills/bundled-catalog.json` — 48KB bundled catalog
- `src/main/core/skills/controller.ts` — RPC endpoints
- `src/shared/core/skills/` — shared types

**Renderer changes:**
- Move `skills-tab.tsx` logic from `features/skills/skills-view.tsx`
- Keep `useSkills` hook from `features/skills/useSkills.ts`
- Keep `SkillCard`, `SkillDetailModal`, `CreateSkillModal` — rename/move to marketplace
- Add **public/private** badge to each skill card (see Sharing section below)
- Add "Publish" action for user-created skills

**What a Skill looks like:**
```ts
interface SkillCard {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'user' | 'remote';
  visibility: 'public' | 'private';    // new field
  installed: boolean;
  tags: string[];
  requiredConnectors: string[];        // so users know what to enable first
}
```

---

## Connectors Tab

**Existing backend (keep as-is):**
- `src/main/core/mcp/services/McpService.ts`
- `src/main/core/mcp/utils/catalog.ts` — built-in catalog entries
- `src/main/core/mcp/controller.ts`
- `src/shared/core/mcp/`

**Renderer changes:**
- Move connectors-tab logic from `features/mcp/mcp-view.tsx`
- Keep `McpCard`, `McpModal`, `useMcps` hook
- Rename UI labels: "MCP server" → "Connector"; "server" → "connector" everywhere in user-facing strings
- Each installed connector shows: name, what it can access, per-workspace enable/disable toggle
- Installing a connector triggers its secure sign-in flow (existing behavior)

---

## Smithery Tab

Smithery is a registry of 6,000+ MCP servers at `registry.smithery.ai`.

**New backend module: `src/main/core/smithery/`**

```
src/main/core/smithery/
├── controller.ts        — RPC endpoints: search, getDetail, install
├── smithery-service.ts  — HTTP client for registry API + local install
└── smithery-types.ts    — SmitheryServer type
```

**Registry API (from Smithery docs):**

```
GET https://registry.smithery.ai/servers
  ?q=<search term>
  &page=<number>
  &pageSize=<number>
Authorization: Bearer <token>

Response:
{
  "servers": [{
    "qualifiedName": string,    // unique ID (e.g. "exa-mcp-server")
    "displayName": string,
    "description": string,
    "homepage": string,
    "useCount": number,
    "isDeployed": boolean,      // true = Smithery-hosted (HTTP/SSE); false = local (stdio)
    "tools": Array<{ name: string; description: string }>
  }],
  "pagination": { "currentPage": number; "pageSize": number; "totalCount": number }
}
```

Bearer token: stored in Electron safe storage (user enters once during onboarding or
Settings → Connected apps). Do not hardcode.

**Installation flow:**
- For `isDeployed: false` (local/stdio): download and install the server package, configure
  it exactly as the existing manual MCP add flow in `src/main/core/mcp/`
- For `isDeployed: true` (Smithery-hosted): configure as an HTTP/SSE MCP server pointing
  to Smithery's hosted gateway; Smithery manages OAuth for these servers

**Renderer:**
- `smithery-tab.tsx` — search box, infinite-scroll results, filter by category/tags
- `use-smithery.ts` — calls `rpc.smithery.search(...)` and `rpc.smithery.install(...)`
- Server cards show: name, description, `useCount`, source badge "Smithery", hosted vs local badge, Install button
- After install, server appears in the Connectors tab as a normal connector

Add Smithery RPC namespace to `src/main/rpc.ts`:
```ts
smithery: smitheryController,
```

---

## My Items Tab

Shows the user's:
- Installed Skills (with uninstall action)
- Installed Connectors (with disable/remove action)
- User-created Skills (with edit, publish, visibility toggle)
- User-created Automations that have been shared (link to Automations view)

Aggregates data from: `useSkills()`, `useMcps()`, and future `usePublishedItems()`.

---

## Public/Private Sharing

Skills (and eventually Connectors and Automations) can be marked Public or Private.

**Phase 1:** Private only. A user creates a skill; it lives in their local SQLite DB. No
publishing.

**Phase 2:** Public sharing via self-deployed backend. When a user clicks "Publish →
Public":
1. The skill definition is posted to the self-deployed backend API
2. The backend generates a shareable ID and URL
3. Other team members' Rocky instances can browse and install it from "My items" or a
   shared catalog tab

The self-deployed backend spec is out of scope for this doc; the Rocky client-side
contract is: `rpc.sharing.publish({ itemType, itemId })` → `{ sharedId, shareUrl }`.

**Visibility badge in the UI:**
- 🔒 Private — default for user-created items
- 🌐 Public — visible to teammates after publishing

---

## Item Card Component

`item-card.tsx` is shared across all four tabs:

```tsx
<ItemCard
  name="Draft IC memo"
  description="Drafts an investment committee memo from a data room."
  source="builtin"           // 'builtin' | 'user' | 'smithery' | 'remote'
  visibility="public"        // 'public' | 'private' | undefined (for builtin)
  installed={true}
  requiredConnectors={['drive', 'notion']}
  onInstall={...}
  onUninstall={...}
  onEdit={...}
  onPublish={...}
/>
```

Source badge: "Built-in", "Smithery", "Yours", "Team" (for items shared by others).

---

## Existing Catalog Integration

The existing `skills.sh`-based remote catalog in `SkillsService.searchSkillSh()` remains
as a background catalog source. In the UI it is shown under the Skills tab alongside the
built-in catalog. Do not remove it.

---

## Security

- Smithery Bearer token is stored in Electron safe storage, never in SQLite or log files.
- When installing a Smithery server with `isDeployed: true`, the HTTP/SSE URL must be
  validated (must start with `https://`) and stored via the existing MCP safe storage path.
- Never auto-run a newly installed connector — require the user to enable it per-workspace
  before it is available to the co-worker.
