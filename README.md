# Rocky

<div align="center">

[Contributing](CONTRIBUTING.md)

<br />

[![Apache 2.0 License](https://img.shields.io/badge/License-Apache_2.0-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)

</div>

Rocky is a cross-platform Electron desktop app for non-technical business users — finance
professionals, knowledge workers, and operations teams — to run AI agents against their
documents and connected business apps.

Each chat runs in its own isolated workspace. Rocky connects to your existing tools
(Google Drive, Linear, Notion, Jira, and more) and surfaces results as structured
artifacts you can review, edit, and act on.

## What You Can Do

- Chat with AI agents and get structured results — documents, tables, reports, code.
- Connect your business apps as context sources (Google Drive, Linear, Slack, and more).
- Build and share automations that run on a schedule or on demand.
- Browse and install skills and connectors from the Marketplace.
- Review agent actions before they run with inline approval cards.

## Development

Rocky is built on top of the [emdash](https://github.com/generalaction/emdash)
infrastructure. See the [Contributing Guide](CONTRIBUTING.md) to get a local dev
environment running.

## Privacy

Rocky is local-first. App state is stored in a local SQLite database and Rocky does not
send your documents or chats to Rocky servers.

Agent actions may send data to connected third-party services. Each connector's data
handling depends on the provider you choose.

Telemetry is optional and can be disabled in Settings or by launching with:

```bash
TELEMETRY_ENABLED=false
```

## Contributing

Contributions are welcome. Read the [Contributing Guide](CONTRIBUTING.md) to get started.

## License

Licensed under the [Apache-2.0 license](LICENSE.md).
