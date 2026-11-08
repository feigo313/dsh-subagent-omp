# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
