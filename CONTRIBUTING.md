# Contributing to dsh-subagent-omp

Thanks for considering a contribution. This is a small, focused plugin:
one provider, one tool, no UI. Changes should stay that way.

## Development setup

No build step and no dependency install are required — the bundle is
self-contained (runtime-only `@deepseek-ai` dependencies ship in
`vendor/`).

```
node --check lib/index.js      # syntax
npm test                       # offline regression suites (no OMP needed)
npm pack --dry-run             # packaging integrity
```

The test suites stub the `dsh-subprocess` seam and the child streams, so
they run anywhere Node 22+ runs — no local `omp` installation required.

## What belongs here

- Fixes to the provider lifecycle: spawn/teardown, the serial queue, the
  watchdog, output extraction from the child's `--mode json` JSONL stream.
- Config surface changes that stay within the plugin's one responsibility:
  delegating to the locally installed `omp` CLI with its own `~/.omp`
  configuration.
- Documentation that reflects actual behavior.

## What does not belong here

- Model or provider selection — the child inherits the user's own `~/.omp`
  bindings; this plugin never configures them.
- Follow-up messaging, session persistence, or progress streaming — the
  provider is deliberately one-shot (see README "Known Limitations").
- Anything that would give the harness's host process visibility into the
  child beyond the selected answer and a bounded failure diagnostic.

## Commit and PR guidelines

- One logical change per commit; test suites live in `test/*.test.mjs`.
- Every behavioral fix ships with a test that fails without it.
- Update `CHANGELOG.md` under `## [Unreleased]`.
- CI (`.github/workflows/ci.yml`) must pass: syntax, manifest validity,
  offline suites, and pack integrity.
