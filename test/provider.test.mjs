import assert from "node:assert";
const mod = await import("../lib/index.js");
console.log("exports:", Object.keys(mod).join(","));
assert.equal(mod.name, "subagent-omp");
assert.deepEqual(mod.inject, ["subagents", "subprocess"]);
console.log("Config defaults:", JSON.stringify(mod.Config({})));

let spawnSpec = null;
let settleChild;
function fakeSpawn(spec) {
  spawnSpec = spec;
  return {
    stdin: undefined,
    stdout: { on(ev, fn) { if (ev === "data") setTimeout(() => fn(Buffer.from(
      JSON.stringify({id:"s1",cwd:"X",version:"1",model:"m"}) + "\n" +
      JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:[{type:"text",text:"最终答案 42"}]}]})
    ) + "\n"), 5); }, off() {}, emit(ev) { if (ev === "end") this._end?.(); } },
    stderr: { on() {}, off() {} },
    done: new Promise((res) => { settleChild = () => res({ exitCode: 0, signal: null }); }),
    terminate() {},
    async waitForExit() { return true; },
  };
}
const runs = [];
mod.apply({ subagents: { registerProvider: (p) => runs.push(p) }, subprocess: { spawn: fakeSpawn }, logger: { warn: (m) => console.log("[warn]", m) } }, {});
assert.equal(runs.length, 1, "provider registered");
const provider = runs[0];
assert.equal(provider.name, "omp");
assert.deepEqual(provider.capabilities, { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false });

const request = { cwd: process.cwd(), prompt: [{ type: "text", text: "任务" }], signal: new AbortController().signal };
const runPromise = provider.start(request);   // serialized: resolves after settle
await new Promise((r) => setTimeout(r, 10)); settleChild();  // let queue start, then child exits
const run = await runPromise;                  // queue advances
const result = await run.result;
console.log("argv:", JSON.stringify(spawnSpec.argv));
console.log("stdio.stdin:", JSON.stringify(spawnSpec.stdio.stdin).slice(0, 40) + "...");
console.log("stopReason:", result.stopReason, "| output:", JSON.stringify(result.output));
assert.equal(result.stopReason, "completed");
assert.equal(result.output[0].text, "最终答案 42");
assert.ok(spawnSpec.argv.includes("--no-session"), "--no-session present");
assert.ok(spawnSpec.argv.includes("--mode") && spawnSpec.argv.includes("json"), "--mode json present");
console.log("test.mjs ALL PASS");
