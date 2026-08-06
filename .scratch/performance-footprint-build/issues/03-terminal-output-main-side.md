# 03 — Terminal output, main side: the log stream becomes the only text path

**What to build:** an agent terminal that streams output for hours no longer grows
main-process memory. The capped append-only log stream becomes the single source of terminal
text: the caller-less unbounded string buffer in the ACP terminal live registry is deleted,
the published terminals LiveModel carries lifecycle metadata only (id, command, status, exit,
`truncated`) with no `output` field, and the conversation-level republish fires on lifecycle
transitions instead of on every output chunk. Chat continues to stream terminal output
exactly as before, via the log subscription.
Spec: [terminal output decision, parts 1–2](../../performance-footprint/issues/01-agent-terminal-output-stream.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** ready-for-agent

- [ ] The registry's per-terminal `output` accumulation and its dead snapshot reader are gone
- [ ] Published terminal state contains no output text; `truncated` metadata is preserved
- [ ] Conversation republish happens only on terminal create/exit/release, not per chunk
- [ ] Existing registry hook tests updated; a test asserts memory-relevant state stays
      constant-size as chunks stream
- [ ] Manual check: agent-run command output still streams live into the chat execute row
