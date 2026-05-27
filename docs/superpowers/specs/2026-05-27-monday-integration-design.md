# Monday.com Integration Design

## Summary

Add Monday.com as an issue provider integration in emdash, following the same 3-layer pattern as the existing Linear integration. Users connect with a personal API token and optionally specify board URLs to scope which items are shown.

## Requirements

- Monday.com board items map to emdash `Issue` entities
- Authentication via personal API token (paste-in)
- Optional board URL field to scope items to specific boards
- If no boards specified, query items assigned to the authenticated user
- Parse numeric board IDs from pasted Monday board URLs
- Implements the standard `IssueProvider` interface (list, search, getIssueContext)

## Architecture

### File Structure

```
src/main/core/monday/
├── monday-connection-service.ts   # Token + board storage, API validation, client caching
├── monday-issue-provider.ts       # IssueProvider implementation, GraphQL queries
└── controller.ts                  # RPC endpoints
```

### Layers

| Layer | Responsibility |
|-------|----------------|
| Connection Service | Stores credentials in encrypted secrets, validates token against Monday API, caches auth state |
| Issue Provider | Implements `IssueProvider` interface, transforms Monday board items to normalized `Issue` type |
| Controller | Thin RPC wrapper exposing `saveCredentials`, `clearCredentials`, `checkConnection` |

## Authentication & Configuration

### Credentials Model

```typescript
type MondayCredentials = {
  token: string;
  boardIds: string[]; // numeric IDs parsed from board URLs
};
```

Stored as a single JSON blob in `encryptedAppSecretsStore` under key `'emdash-monday-credentials'`.

### Setup Flow

1. User enters API token (required) and board URLs (optional, comma-separated)
2. Board URLs like `https://myteam.monday.com/boards/123456` are parsed to extract numeric IDs
3. Token is validated against Monday API (`query { me { name account { name } } }`)
4. On success, credentials stored and connection status updated

### Board URL Parsing

Extract board ID from URLs matching pattern: `https://*.monday.com/boards/<id>`

If no board URLs provided, the integration queries items assigned to the authenticated user across all accessible boards.

## Data Mapping

Monday board item → emdash `Issue`:

| Monday Field | Issue Field | Notes |
|---|---|---|
| `item.id` | `identifier` | String ID |
| `item.name` | `title` | |
| Status column value | `status` | From `column_values` where column type is `status` |
| Person column value | `assignees` | From `column_values` where column type is `people` |
| Constructed URL | `url` | `https://<account>.monday.com/boards/<boardId>/pulses/<itemId>` |
| Board name or group name | `project` | |
| `item.updated_at` | `updatedAt` | |
| Now | `fetchedAt` | |
| Updates/comments | `context` | For `getIssueContext`, formatted as markdown |

## API Approach

### No SDK Dependency

Monday's GraphQL API is simple enough to call via raw `fetch`. No `@monday-apps/sdk` needed — avoids an unnecessary dependency.

### Endpoint

All requests go to `https://api.monday.com/v2` with:
- `Authorization: <token>` header
- `Content-Type: application/json`
- POST body with `query` and optional `variables`

### Key Queries

**Validate token:**
```graphql
query { me { id name account { name } } }
```

**List items from specific boards:**
```graphql
query ($boardIds: [ID!]!, $limit: Int!) {
  boards(ids: $boardIds) {
    name
    items_page(limit: $limit) {
      items {
        id
        name
        updated_at
        group { title }
        column_values {
          id
          type
          text
          value
        }
      }
    }
  }
}
```

**List items assigned to user (no board filter):**
```graphql
query ($userId: ID!, $limit: Int!) {
  boards {
    name
    items_page(limit: $limit, query_params: { rules: [{ column_id: "person", compare_value: [$userId] }] }) {
      items { ... }
    }
  }
}
```

**Search items:**
```graphql
query ($boardIds: [ID!]!, $term: String!, $limit: Int!) {
  boards(ids: $boardIds) {
    items_page(limit: $limit, query_params: { rules: [{ column_id: "name", compare_value: [$term], operator: contains_text }] }) {
      items { ... }
    }
  }
}
```

**Get issue context (with updates/comments):**
```graphql
query ($itemId: ID!) {
  items(ids: [$itemId]) {
    id
    name
    updates {
      id
      body
      text_body
      created_at
      creator { name }
    }
    column_values { id type text value }
  }
}
```

## Provider Capabilities

```typescript
monday: {
  requiresProjectPath: false,
  requiresRepositoryUrl: false,
}
```

## Registration Points

1. Add `'monday'` to `Issue['provider']` union in `src/shared/tasks.ts`
2. Add `monday` entry to `ISSUE_PROVIDER_CAPABILITIES` in `src/shared/issue-providers.ts`
3. Add `IssueProviderType` union member
4. Register `mondayIssueProvider` in `src/main/core/issues/registry.ts`
5. Register `mondayController` in `src/main/rpc.ts`

## Renderer Changes

### New Files

```
src/renderer/features/integrations/
└── monday-setup-form.tsx    # Token input + board URLs textarea
```

### Modified Files

- `integrations-provider.tsx` — Add Monday to `PROVIDER_CONNECTION_CONFIG`
- `issue-provider-meta.ts` — Add Monday to `ISSUE_PROVIDER_ORDER` and `ISSUE_PROVIDER_META`
- `integration-setup-modal.tsx` — Add Monday case to provider dispatch

### Setup Form

Two fields:
1. **API Token** (password input, required) — with help text linking to Monday account settings
2. **Board URLs** (textarea, optional) — comma or newline separated Monday board URLs

### Provider Config

```typescript
monday: {
  connectMutationFn: (credentials: { token: string; boardUrls: string }) =>
    rpc.monday.saveCredentials(credentials),
  disconnectMutationFn: () => rpc.monday.clearCredentials(),
  fallbackError: DEFAULT_CONNECT_ERROR,
  validateInput: validateMondayInput, // checks token non-empty
},
```

## Error Handling

- Invalid token → `{ success: false, error: "Invalid Monday.com API token..." }`
- Invalid board URL format → `{ success: false, error: "Could not parse board ID from URL: ..." }`
- Board not accessible → `{ success: false, error: "Board not found or not accessible..." }`
- Network/API errors → pass through Monday's error message

## Testing

- Unit tests for board URL parsing (various valid/invalid formats)
- Unit tests for Monday item → Issue transformation
- Unit tests for connection service (mock fetch)
- Integration test for controller RPC wiring

## Out of Scope

- OAuth2 authentication flow
- Subitem support
- Board creation or item mutation
- Webhook/real-time updates
- Monday.com workspace switching
