# agent-cdp Command Notes

Use `agent-cdp --help` for the current command tree.

Important command groups:

- `start`, `status`, `stop` for daemon lifecycle.
- `target list`, `target select`, `target clear` for attach points.
- `console list`, `console get` for logs collected while connected.
- `runtime eval`, `runtime props`, `runtime release` for live state inspection.
- `network start/stop/summary/list/request/*-headers/*-body` for request evidence.
- `trace start/stop/summary/tracks/entries/entry` for timeline evidence.
- `profile cpu start/stop/summary/hotspots/stacks/slice/diff/export` for CPU profiling.
- `memory snapshot`, `memory usage`, `memory allocation`, and `memory allocation-timeline` for leak and allocation analysis.

React Native usually requires Metro or the dev tooling to expose a CDP target, commonly on `http://127.0.0.1:8081`. Physical-device or LAN-only dev-server setups may need port forwarding or a reachable URL.
