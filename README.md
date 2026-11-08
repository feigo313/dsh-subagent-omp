# dsh-subagent-omp

DeepSeek Harness plugin: delegate one task at a time to your locally installed
[OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) agent. The spawned `omp`
child runs with **its own `~/.omp` configuration** — its provider, model
bindings, MCP servers, and approval settings are whatever your OMP
installation already has. This plugin never configures or overrides them.

The plugin icon is adapted from the Oh My Pi project logo
(`assets/icon.svg`, MIT, © Mario Zechner, Can Bölük, Stencil Labs, Inc.).

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

## When to use it

Install this Profile Bundle when a delegated task should run as a fresh,
unattended OMP session in the parent Session's workspace — typically to spend a
local or differently-metered model instead of the harness's own LLM route.
Each delegation uses one self-contained text task and returns only the selected
answer or a safe failure diagnostic. Native OMP configuration and
authentication remain authoritative. Choose it when running on the OMP
runtime's own model matters more than continuation or harness-side tools.

Routing between the sibling delegation tools is the model's choice at call
time; the tool description carries the same one-shot wording as the official
product providers, so a delegation goes to OMP when the user names it, or when
the model judges an offload suitable for the OMP runtime. There is no
automatic catch-all: `subagent` (in-process), `subagent_fork`
(context-inheriting), and `subagent_omp` coexist and none of them claims
another's tasks.

## Known Limitations and Deferred Work

These limits define when this provider is a poor fit or needs special
operational care. They are current package constraints, not a general OMP
comparison or a task backlog.

- **One fresh process and turn per run** — there is no continuation, resume,
  pooling, progress stream, or OMP-session persistence (`--no-session`).
- **Static instance selection** — the Profile row fixes the provider name and
  tool binding; calls cannot choose or change a model dynamically (the child
  inherits whatever `~/.omp` binds).
- **Authentication and configuration remain native** — the Bundle spawns the
  CLI but does not create accounts, log in, or rewrite OMP settings; a missing
  API key or unreachable provider surfaces as a child run failure with the
  child's stderr tail as the diagnostic.
- **The `omp` executable is required at delegation time** — resolution prefers
  the npm package's bin entry and falls back to `omp` on the harness host's
  PATH; there is no bundled OMP payload.
- **Runs are serialized** — a second delegation queues until the previous
  child's run settles; parallel fan-out through this provider is not possible.
- **No human approval path** — the child runs with whatever approval mode the
  user's OMP configuration grants; this Bundle adds no interaction channel.
- **Assistant payload is the selected answer text only** — reasoning,
  intermediate messages, tool traffic, and usage remain outside the parent
  Session; failed runs expose a safe diagnostic instead.
- **No optional shared capabilities** — `agentPreset`, `agentOptions`, output
  schemas, and harness depth enforcement are rejected by the shared service
  for this provider.
- **No wall-clock timeout beyond `maxTime`** — the child is terminated at the
  configured deadline, and files or external systems changed before that point
  are not restored.

## Install

### Method one: plugin market (Discover tab)

Once listed on [awesome-dsh-plugin](https://awesome-dsh-plugin.com/), search
for `dsh-subagent-omp` in the Harness plugin market (Plugins → Discover) and
install it there.

### Method two: npm

```bash
npm install -g dsh-subagent-omp
```

Then point the Harness at the package directory, or install with the
`plugin_manager` tool:

```
plugin_manager install_bundle --target <global-node_modules>/dsh-subagent-omp
```

New npm releases are subject to the harness profile's fresh-release policy
(`minimumReleaseAge`); a just-published version becomes installable about an
hour after publish.

### Method three: GitHub Release

Download the prebuilt tarball from the
[Releases page](https://github.com/feigo313/dsh-subagent-omp/releases) and
install it with `plugin_manager` `install_bundle` pointed at the `.tgz` file,
or pin the dependency in a profile `package.json` as a local `file:` path
(`file:` entries get a lockfile integrity, URL entries do not).

### Development: local checkout

In the Harness plugin manager, choose "Install from directory" and select
this checkout; or `plugin_manager` with `action: install_bundle` and the
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

MIT — see [LICENSE](LICENSE). Third-party code and assets in this bundle carry
their own attribution: `vendor/out-of-process.js` contains MIT-licensed code
from `@deepseek-ai/dsh-subagent`, and `icon.svg` is adapted from the
MIT-licensed Oh My Pi project logo (`assets/icon.svg`).
