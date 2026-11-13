# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Offline regression suites under `test/`: provider lifecycle, output
  extraction, cost-cap mapping, and the serial-queue ordering contract
  (`npm test`).
- GitHub Actions CI: syntax checks, manifest validation, offline suites,
  and `npm pack` integrity on every push and pull request.
- Queue watchdog safety: the serialized run aborts a child that outlives
  `maxTime` plus a 60 s grace, so a hung child cannot block later
  delegations.
- Bounded stdout capture: child JSONL output is capped at 2 MiB (ring
  window keeps the tail) so long runs cannot grow memory without bound.
- Raised the default `maxTime` to `2h`: local engines are unmetered, and
  the previous 30 m default truncated legitimate long tasks.

## [0.1.1] - 2026-11-13

### Changed

- Target DeepSeek Harness `0.2.2-rc.2`: `@deepseek-ai/dsh-tool-subagent`
  (dependency) and `@deepseek-ai/dsh-subagent` / `dsh-subprocess` /
  `dsh-timeout` (peers) bumped from `0.2.2-rc.1` to `0.2.2-rc.2`. No code
  changes were required — the vendored out-of-process helpers and the
  `SubagentProvider` seam are byte-identical between the two releases.
- Documentation version references updated to match.

## [0.1.0] - 2026-11-08

### Added

- One-shot OMP subagent provider: each delegation spawns the locally installed
  `omp` CLI with `--print --mode json --no-session`, feeds the task through
  stdin, and returns the answer selected from the child's `agent_end` JSONL
  event.
- Serial run queue: one OMP child at a time in submission order, so a
  single-session local model engine is never oversubscribed.
- Model-facing `subagent_omp` delegation tool, mounted through the shared
  `@deepseek-ai/dsh-tool-subagent` composition.
- Whole-run deadline (`maxTime`, default `30m`) passed to the child as
  `--max-time`; cost-cap exit (code 3) is surfaced as a dedicated diagnostic.
- Self-contained bundle: runtime-only `@deepseek-ai` dependencies ship under
  `vendor/` so a directory-linked install resolves without host node_modules;
  out-of-process seam helpers vendored from `@deepseek-ai/dsh-subagent` (MIT).
- Bilingual display resources (en/zh) and an icon adapted from the
  Oh My Pi project logo.

[0.1.0]: https://github.com/feigo313/dsh-subagent-omp/releases/tag/v0.1.0
[0.1.1]: https://github.com/feigo313/dsh-subagent-omp/releases/tag/v0.1.1
