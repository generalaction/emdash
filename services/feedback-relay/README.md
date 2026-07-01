# Emdash feedback relay

Cloudflare Worker that receives in-app feedback (`multipart/form-data`: a
`content` field plus `file0…N`) and posts it to Slack `#feedback`. It holds the
Slack bot token so the token never ships in the desktop app.

Deployed independently — not part of the pnpm workspace.

## Deploy

```bash
pnpm exec wrangler login
pnpm exec wrangler deploy                          # prints the Worker URL
pnpm exec wrangler secret put SLACK_BOT_TOKEN      # xoxb-... (paste at prompt)
pnpm exec wrangler secret put RELAY_SHARED_SECRET  # optional; must match app build
```

The Worker URL and `RELAY_SHARED_SECRET` go into the app build as
`VITE_FEEDBACK_RELAY_URL` / `VITE_FEEDBACK_RELAY_SECRET`.

`SLACK_CHANNEL_ID` is set in `wrangler.toml`. For local runs use `wrangler dev`
with a `.dev.vars` file.
