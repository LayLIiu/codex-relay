---
name: agent-cdp
description: Chrome DevTools Protocol CLI workflow for runtime, console, network, trace, memory, and JavaScript CPU profiling analysis. Use when Codex needs to inspect debuggable Chrome/Chromium tabs, Node processes started with --inspect, React Native/Metro/Hermes targets, or to combine agent-device UI driving with CDP evidence for performance, heat, re-render, network, memory, or runtime-state diagnosis.
---

# agent-cdp

Use `agent-cdp` for evidence-backed runtime diagnostics through Chrome DevTools Protocol. Pair it with `agent-device` when a mobile UI interaction must be driven on a simulator/device while CDP records what the JS runtime, network, or profiler did.

## First Step

Load the bundled upstream guide before non-trivial use:

```bash
agent-cdp skills get core
```

If that command cannot read bundled skills, fall back to the installed package files:

```bash
AGENT_CDP_ROOT="$(npm root -g)/agent-cdp"
sed -n '1,220p' "$AGENT_CDP_ROOT/skills/core.md"
```

## Core Workflow

1. Start/check the daemon:

```bash
agent-cdp start
agent-cdp status
```

2. Find and select a target:

```bash
agent-cdp target list
agent-cdp target list --url http://127.0.0.1:8081
agent-cdp target list --url http://127.0.0.1:9229
agent-cdp target select <target-id>
```

Default target scanning checks local Chrome, Node inspect, and Metro-style endpoints. If no React Native target appears, first verify Metro/dev-server reachability and whether the app is actually running in a debuggable dev mode.

React Native/Metro inspector endpoints may reject WebSocket connections with HTTP 401 unless the client sends an Origin such as `http://localhost:8081`. If `target list` sees a React Native target but `target select` fails with 401, verify the installed `agent-cdp` transport sends that Origin for targets whose `kind` is `react-native` or whose websocket URL contains `/inspector/debug`.

3. Capture only the evidence needed:

```bash
agent-cdp console list --limit 50
agent-cdp runtime eval --expr "globalThis.location?.href ?? process.version" --json
agent-cdp network start --name repro
agent-cdp trace start
agent-cdp profile cpu start --name hot-path
```

4. Reproduce the interaction. For mobile, drive the UI with `agent-device`:

```bash
agent-device --session <name> snapshot
agent-device --session <name> press <target>
agent-device --session <name> wait 1000
```

5. Stop and inspect:

```bash
agent-cdp network stop
agent-cdp network summary
agent-cdp network list --limit 20
agent-cdp trace stop
agent-cdp trace summary
agent-cdp profile cpu stop
agent-cdp profile cpu hotspots --limit 20
```

## Common Tasks

For heat or high CPU, prefer a bounded CPU profile around the suspect interaction, then inspect hotspots and stacks. Also capture a process snapshot with `ps` so CDP findings can be correlated with OS-level CPU.

For slow or noisy network behavior, use `network start`, reproduce once, then inspect `network summary`, filtered `network list`, and only specific request/response headers or bodies. Avoid dumping auth headers or secrets.

For runtime state, use `runtime eval` with read-only expressions. Do not mutate app state from CDP unless the user explicitly asks for that side effect.

For trace-style UI performance, use `trace start/stop` around a short interaction and inspect summary/tracks/entries. Export the raw trace only when compact summaries are insufficient.

For memory leaks, take baseline/action/cleanup samples or snapshots, then use the built-in memory diff/leak commands. Keep heap artifacts out of commits unless explicitly requested.

## Safety

Prefer short captures over long recordings. Stop active network, trace, CPU, or allocation sessions before finishing. Report when no CDP target is available instead of pretending profile evidence exists.
