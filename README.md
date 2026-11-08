# dsh-subagent-omp

DeepSeek Harness plugin: delegate one task at a time to your locally installed
[OMP](https://github.com/can1357/oh-my-pi) agent. The spawned `omp` child runs
with **its own `~/.omp` configuration** — its provider, model bindings, MCP
servers, and approval settings are whatever your OMP installation already has.
This plugin never configures or overrides them.

## What it does

- Registers a one-shot subagent provider (`omp`) in the DSH agent-team seam.
- Exposes one model-facing tool, `subagent_omp`, alongside the built-in
  `subagent` / `subagent_fork` tools. When the OMP bundle is enabled, the model
  can hand a self-contained task to your local OMP installation and get its
  final answer back.
- Spawns `omp --print --mode json --no-session` per delegation, feeds the task
  through stdin, and selects the final answer from the JSONL `agent_end` event.
- **Serializes** delegations: one OMP child at a time, in submission order.
  Necessary for single-session local model engines (a llama.cpp-style server
  serves one request at a time); harmless for cloud-backed OMP setups.
- One-shot semantics, mirroring the official `@deepseek-ai/dsh-subagent-codex`
  and `@deepseek-ai/dsh-subagent-claude-code` bundles: the child cannot receive
  follow-up messages, and the run leaves no OMP session on disk.

## Install

In DeepSeek Harness:

```
Plugin Manager → Install from directory → select this checkout
```

or programmatically: `plugin_manager` with `action: install_bundle` and the
absolute path of this directory.

## Configuration

The bundle exposes a settings entry (`subagent-omp`) with:

| Key | Default | Meaning |
| --- | --- | --- |
| `providerName` | `omp` | Registry name of the provider. |
| `maxTime` | `30m` | Whole-run deadline passed to the child as `--max-time` (`<number>[s\|m\|h]`). |
| `env` | `{}` | Extra environment entries merged onto the scrubbed parent environment. |
| `disposeGraceMs` | `3000` | Termination grace for the managed child process. |

## Requirements

- An `omp` executable resolvable from the harness host (PATH or npm package).
- DeepSeek Harness `0.2.2-rc.1` (the subagent seam is provided by the host;
  runtime-only dependencies ship inside this bundle's `vendor/` tree so a
  directory-linked install resolves everywhere).

## License

MIT — see [LICENSE](LICENSE). `vendor/out-of-process.js` contains MIT-licensed
code from `@deepseek-ai/dsh-subagent`; attribution is included there.
