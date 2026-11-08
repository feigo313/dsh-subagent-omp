/**
 * One-shot OMP subagent provider.
 *
 * Every accepted run spawns the locally installed `omp` CLI with
 * `--print --mode json --no-session`, feeds the task through stdin, and
 * selects the final answer from the `agent_end` JSONL event on stdout.
 * The child inherits the user's `~/.omp` configuration — its provider, model,
 * and approval settings are the OMP installation's own, never overridden —
 * so a module-level serial queue holds each spawn until the previous run
 * fully settles (safe for single-session local engines, harmless elsewhere).
 * Publication, result settlement, and teardown follow the shared
 * out-of-process seam (`settleRunResult` + `subprocessRunHandle`), mirroring
 * `@deepseek-ai/dsh-subagent-codex`.
 *
 * @module dsh-subagent-omp
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
// A directory-linked bundle sits outside every node_modules tree, so bare
// imports cannot resolve at runtime. Resolve the two runtime-only entities
// from the host profile explicitly; everything else is vendored or Node built-in.
const here = dirname(fileURLToPath(import.meta.url));
const hostRequire = createRequire(join(here, "package.json"));
/**
 * Load an ESM package by walking a list of candidate resolution bases.
 * @param {string} name - package name to import.
 * @param {string[]} bases - directories whose node_modules may hold it.
 * @returns {Promise<Record<string, unknown>>} the package namespace.
 */
async function importFromBases(name, bases) {
	const errors = [];
	for (const base of bases) {
		try {
			const manifestPath = hostRequire.resolve(`${name}/package.json`, { paths: [base] });
			const manifest = JSON.parse(hostRequire("node:fs").readFileSync(manifestPath, "utf8"));
			// Mirror Node's entry choice: exports["."].default when present, else main.
			const entry =
				typeof manifest.exports?.["."] === "object" && typeof manifest.exports?.["."]?.default === "string"
					? manifest.exports["."].default
					: (manifest.main ?? "index.js");
			const entryPath = join(dirname(manifestPath), entry);
			return await import(pathToFileURL(entryPath).href);
		} catch (error) {
			errors.push(error);
		}
	}
	throw new Error(
		`subagent-omp: cannot resolve ${name} from any candidate base: ${bases.join(", ")} — ${errors.map((error) => error.message).join("; ")}`,
	);
}
// Candidate bases: the vendor tree shipped with this bundle, then the host
// profile's node_modules (the bundle's parent directory's sibling).
const RESOLVE_BASES = [
	join(here, "..", "vendor"),
	join(here, "..", "..", ".."),
];
const { default: z } = await importFromBases("@deepseek-ai/schemastery", RESOLVE_BASES);
const { brandString } = await importFromBases("@deepseek-ai/dsh-brand", RESOLVE_BASES);
// Vendored from @deepseek-ai/dsh-subagent@0.2.2-rc.1 (MIT) — see vendor/.
import { NO_START_CAPABILITIES, assertPositiveFinite, assertUsableCwd, settleRunResult, subprocessRunHandle } from "../vendor/out-of-process.js";
/** Sentinel from @deepseek-ai/dsh-timeout (a single constant; value is stable upstream). */
const MAX_TIMER_DELAY_MS = 2147483647;

//#region omp CLI resolution
/**
 * Resolve the `omp` executable once at module load, package-local and
 * independent of the harness PATH. `createRequire` walks up from this module,
 * so it sees the user's normal installation, not the harness's execution world.
 */
const require = createRequire(import.meta.url);
let OMP_BIN;
try {
	// The user install is `omp.exe` on PATH (bun shim) or the npm package's bin
	// entry. Prefer the npm package when resolvable; fall back to PATH lookup.
	// Resolution walks the host process's own paths plus this bundle's location.
	OMP_BIN = require.resolve("omp/package.json", { paths: [here, process.cwd()] }).replace(/package\.json$/, "bin/omp.js");
} catch {
	OMP_BIN = undefined;
}
const argvPrefix = OMP_BIN === undefined ? ["omp"] : [process.execPath, OMP_BIN];
//#endregion

//#region serial queue
/**
 * All runs funnel through one promise chain: a queued run starts only after
 * the previous one settled AND its child process is gone. This serializes
 * concurrent delegations onto one OMP child at a time — necessary for
 * single-session local model engines, harmless otherwise. A failed link must
 * not poison the chain, so each runner catches its own errors.
 */
let queueTail = Promise.resolve();
/**
 * Run `body` after every previously enqueued body settled.
 * @template T
 * @param {() => Promise<T>} body - the serialized operation.
 * @returns {Promise<T>} the operation's own outcome.
 */
function enqueue(body) {
	const run = queueTail.then(body, body);
	queueTail = run.then(
		() => {},
		() => {},
	);
	return run;
}
//#endregion

//#region child run
/** Default POSIX grace between subprocess termination tiers. */
const DEFAULT_DISPOSE_GRACE_MS = 3000;
/** Default whole-run deadline passed to the child as `--max-time`. */
const DEFAULT_MAX_TIME = "30m";
/** Valid `--max-time` shapes, mirroring the OMP CLI's own parser. */
const MAX_TIME_RE = /^\d+(?:\.\d+)?[smh]$/;
/** OMP print-mode exit code for a run the cost gate stopped. */
const COST_CAP_EXIT_CODE = 3;

/**
 * Validate the configured `--max-time` value.
 * @param {string} value - configured duration like `30m`.
 * @returns {string} the validated value.
 */
function assertMaxTime(value) {
	if (typeof value !== "string" || !MAX_TIME_RE.test(value)) {
		throw new Error(`subagent-omp: maxTime must match <number>[s|m|h] (e.g. 30m), got ${JSON.stringify(value)}`);
	}
	return value;
}

/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param {readonly {type: string, text?: string}[]} prompt - task content accepted from the shared subagent service.
 * @returns {string} the exact non-empty text.
 */
function textTask(prompt) {
	if (prompt.length === 0) throw new Error("subagent-omp: the one-shot task must contain only text blocks");
	const texts = [];
	for (const block of prompt) {
		if (block.type !== "text") throw new Error("subagent-omp: the one-shot task must contain only text blocks");
		texts.push(block.text);
	}
	// Multi-block prompts (task + attachments) keep block order; blocks join
	// with a blank line so each stays a self-contained section.
	const text = texts.join("\n\n");
	if (text.trim().length === 0) throw new Error("subagent-omp: the one-shot task must not be empty");
	return text;
}

/**
 * Select the best non-commentary assistant text from one `agent_end` event.
 * @param {unknown} event - the parsed JSONL event object.
 * @returns {string | undefined} the selected text, when present.
 */
function agentEndText(event) {
	const messages = event?.messages;
	if (!Array.isArray(messages)) return undefined;
	/** Extract concatenated text parts from one OMP assistant message. */
	const textOf = (message) => {
		const parts = message?.content;
		if (typeof parts === "string") return parts;
		if (!Array.isArray(parts)) return "";
		return parts
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("");
	};
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = textOf(message);
		if (text.trim().length > 0) return text;
	}
	return undefined;
}

/**
 * Extract the final answer from complete JSONL stdout.
 * @param {string} stdout - full stdout text.
 * @returns {string} the selected assistant text, or "" when none.
 */
function extractOutput(stdout) {
	const lines = stdout.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index].trim();
		if (line.length === 0) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event?.type !== "agent_end") continue;
		const text = agentEndText(event);
		if (text !== undefined) return text;
	}
	return "";
}

/**
 * Settle one finished child into facts for diagnostics.
 * @param {number | null} exitCode - child exit code.
 * @param {import("@deepseek-ai/dsh-subprocess").SubprocessOutcome["signal"]} signal - terminating signal.
 * @returns {{stage: string, category: string, outcome: {exitCode: number | null, signal: string | null}}} failure facts.
 */
function processFailureFacts(exitCode, signal) {
	return { stage: "process", category: "process", outcome: { exitCode, signal } };
}

/**
 * Run one serialized OMP child to completion in the delegating workspace.
 * @param {import("@deepseek-ai/dsh-subagent").ResolvedSubagentStartRequest} request - resolved shared request.
 * @param {{cwd: string, maxTime: string, env: Record<string, string>, disposeGraceMs: number, spawn: (spec: unknown) => import("@deepseek-ai/dsh-subprocess").SubprocessHandle, onError?: (error: Error, stopReason: string) => void}} spec - resolved run inputs.
 * @returns {Promise<import("@deepseek-ai/dsh-subagent").SubagentRun>} the published run handle.
 */
function startOmpRun(request, spec) {
	const prompt = textTask(request.prompt);
	if (request.signal.aborted) throw new Error("subagent-omp: request was aborted before omp startup");
	const child = spec.spawn({
		argv: [
			...argvPrefix,
			"--print",
			"--mode",
			"json",
			"--no-session",
			"--max-time",
			spec.maxTime,
		],
		cwd: spec.cwd,
		stdio: {
			stdin: { data: prompt },
			stdout: "pipe",
			stderr: "pipe",
		},
		graceMs: spec.disposeGraceMs,
		env: spec.env,
	});
	// Drain stderr so a chatty child cannot wedge on a full pipe; keep the tail
	// for diagnostics. stdout stays unread here — the reader below consumes it.
	let stderrTail = "";
	child.stderr?.on("data", (chunk) => {
		const text = typeof chunk === "string" ? chunk : String(chunk);
		stderrTail = stderrTail.length + text.length > 8192 ? (stderrTail + text).slice(-8192) : stderrTail + text;
	});
	child.stderr?.on("error", () => {});

	let stdoutText = "";
	// 'close'-style done can race the last stdio chunks on some providers; gate
	// extraction on stdout actually ending so the answer is never read early.
	const stdoutEnded = new Promise((resolve) => {
		child.stdout?.on("end", resolve);
		child.stdout?.on("error", resolve);
	});
	child.stdout?.on("data", (chunk) => {
		stdoutText += typeof chunk === "string" ? chunk : String(chunk);
	});
	child.stdout?.on("error", () => {});

	const cancelled = () => request.signal.aborted;
	const attempt = async () => {
		const outcome = await child.done;
		await Promise.race([stdoutEnded, new Promise((resolve) => setTimeout(resolve, 200))]);
		const output = extractOutput(stdoutText);
		if (cancelled()) return { output: [{ type: "text", text: output }], stopReason: "aborted" };
		if (outcome.exitCode === 0 && output.length > 0) {
			return { output: [{ type: "text", text: output }], stopReason: "completed" };
		}
		if (outcome.exitCode === COST_CAP_EXIT_CODE) {
			return {
				output: [{ type: "text", text: output }],
				stopReason: "error",
				diagnostic: "Product subagent failure (product: OMP; stage: turn; category: cost-cap; exit code: 3)",
			};
		}
		const facts = processFailureFacts(outcome.exitCode, outcome.signal);
		const detail = stderrTail.trim().length > 0 ? `\n${stderrTail.trim().slice(-2048)}` : "";
		return {
			output: [{ type: "text", text: output }],
			stopReason: "error",
			diagnostic: `Product subagent failure (product: OMP; stage: ${facts.stage}; category: ${facts.category}; exit code: ${String(outcome.exitCode)}; signal: ${String(outcome.signal)})${detail}`,
		};
	};
	const result = settleRunResult({
		attempt,
		collectOutput: () => [{ type: "text", text: extractOutput(stdoutText) }],
		cancelled,
		onError: spec.onError,
		signal: request.signal,
		onAbort: () => {
			try {
				child.terminate();
			} catch {}
		},
	});
	const teardown = async () => {
		try {
			child.terminate();
		} catch {}
		try {
			await child.waitForExit();
		} catch {}
		await child.done.catch(() => {});
	};
	return subprocessRunHandle({
		id: brandString(randomUUID()),
		result,
		signal: request.signal,
		onAbort: () => {
			try {
				child.terminate();
			} catch {}
		},
		requestCancel: () => {
			try {
				child.terminate();
			} catch {}
		},
		teardown,
	});
}
//#endregion

//#region provider plugin
const name = "subagent-omp";
const inject = ["subagents", "subprocess"];
const DEFAULT_PROVIDER_NAME = "omp";
const Config = z.object({
	providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
	maxTime: z.string().min(1).default(DEFAULT_MAX_TIME),
	env: z.dict(z.string()).default({}),
	disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
});

var OmpProvider = class {
	name;
	ctx;
	config;
	capabilities = NO_START_CAPABILITIES;
	inheritsParentContext = false;
	/**
	 * @param {string} name - registry name.
	 * @param {{subprocess: {spawn: (spec: unknown) => import("@deepseek-ai/dsh-subprocess").SubprocessHandle}, logger?: {warn?: (message: string) => void}}} ctx - cordis context carrying the subprocess seam.
	 * @param {{providerName: string, maxTime: string, env: Record<string, string>, disposeGraceMs: number}} config - resolved config.
	 */
	constructor(name, ctx, config) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
	}
	/**
	 * @param {import("@deepseek-ai/dsh-subagent").ResolvedSubagentStartRequest} request - the shared start request.
	 * @returns {Promise<import("@deepseek-ai/dsh-subagent").SubagentRun>} the published run.
	 */
	start(request) {
		let cwd;
		try {
			cwd = assertUsableCwd("subagent-omp", "child cwd", request.cwd);
		} catch (error) {
			if (request.signal.aborted) throw new Error("subagent-omp: request was aborted before omp startup");
			throw error;
		}
		// One OMP child at a time: serialize the WHOLE child lifecycle —
		// the queue holds until the run settles, not merely until publication.
		return enqueue(async () => {
			const handle = startOmpRun(request, {
				cwd,
				maxTime: this.config.maxTime,
				env: this.config.env,
				disposeGraceMs: this.config.disposeGraceMs,
				spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
				onError: (error, stopReason) => {
					this.ctx.logger?.warn?.(`subagent-omp "${this.name}": child run failed (${stopReason}): ${error.message}`);
				},
			});
			await handle.result.catch(() => {});
			return handle;
		});
	}
};

/**
 * Register one Profile-named OMP provider.
 * @param {import("@deepseek-ai/cordis").Context} ctx - context carrying shared subagent and subprocess services.
 * @param {{providerName?: string, maxTime?: string, env?: Record<string, string>, disposeGraceMs?: number}} config - registry name, run deadline, child environment, and disposal grace.
 */
function apply(ctx, config) {
	const resolved = {
		providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
		maxTime: config.maxTime ?? DEFAULT_MAX_TIME,
		env: config.env ?? {},
		disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
	};
	assertMaxTime(resolved.maxTime);
	assertPositiveFinite("subagent-omp", "disposeGraceMs", resolved.disposeGraceMs);
	if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
		throw new Error(`subagent-omp: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
	}
	ctx.subagents.registerProvider(new OmpProvider(resolved.providerName, ctx, resolved));
}
//#endregion

export { Config, apply, inject, name };
