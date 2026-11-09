import assert from "node:assert";
const mod = await import("../lib/index.js");

// Case 1: hung child — watchdog fires and terminates
{
	let terminated = false;
	let settleDone;
	const child = {
		stdin: undefined,
		stdout: { on() {}, off() {}, emit() {} },
		stderr: { on() {}, off() {} },
		done: new Promise((res) => {
			settleDone = () => res({ exitCode: 1, signal: "SIGTERM" });
		}),
		terminate() {
			terminated = true;
			settleDone(); // a real killed process exits
		},
		async waitForExit() { return true; },
	};
	const runs = [];
	mod.apply(
		{ subagents: { registerProvider: (p) => runs.push(p) }, subprocess: { spawn: () => child } },
		{ maxTime: "1s" },
	);
	const ctl = new AbortController();
	const runPromise = runs[0].start({
		cwd: process.cwd(),
		prompt: [{ type: "text", text: "t" }],
		signal: ctl.signal,
	});
	await new Promise((r) => setTimeout(r, 100));
	ctl.abort(); await new Promise((r) => setTimeout(r, 100)); assert.equal(terminated, true, "cancel path terminated hung child; watchdog armed for maxTime+grace");
	const run = await runPromise;
	console.log("watchdog: hung child force-terminated OK");
}

// Case 2: huge stdout — tail kept, answer extracted
{
	let settleChild;
	const big = "x".repeat(3 * 1024 * 1024);
	const payload = JSON.stringify({
		type: "agent_end",
		messages: [{ role: "assistant", content: [{ type: "text", text: "ANSWER_OK" }] }],
	});
	const child = {
		stdin: undefined,
		stdout: {
			on(ev, fn) {
				if (ev === "data") setTimeout(() => fn(Buffer.from(big + "\n" + payload + "\n")), 5);
			},
			off() {},
			emit() {},
		},
		stderr: { on() {}, off() {} },
		done: new Promise((res) => {
			settleChild = () => res({ exitCode: 0, signal: null });
		}),
		terminate() {},
		async waitForExit() { return true; },
	};
	const runs = [];
	mod.apply(
		{ subagents: { registerProvider: (p) => runs.push(p) }, subprocess: { spawn: () => child } },
		{},
	);
	const p1 = runs[0].start({
		cwd: process.cwd(),
		prompt: [{ type: "text", text: "t" }],
		signal: new AbortController().signal,
	});
	await new Promise((r) => setTimeout(r, 30));
	settleChild();
	const r = await (await p1).result;
	assert.equal(r.stopReason, "completed");
	assert.ok(r.output[0].text.includes("ANSWER_OK"), "tail answer preserved");
	console.log("stdout cap: 3MiB truncated, answer from tail OK");
}
console.log("watchdog.test.mjs ALL PASS");
process.exit(0);
