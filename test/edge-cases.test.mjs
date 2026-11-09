import assert from "node:assert";
const mod = await import("../lib/index.js");

// Case 1: exit code 3 (cost cap) → stopReason error + cost-cap diagnostic
{
  let settleChild;
  const child = {
    stdin: undefined,
    stdout: { on(ev, fn) { if (ev === "data") setTimeout(() => fn(Buffer.from(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:[{type:"text",text:"部分"}]}]})) + "\n"), 2); }, off() {}, emit() {} },
    stderr: { on() {}, off() {} },
    done: new Promise((res) => { settleChild = () => res({ exitCode: 3, signal: null }); }),
    terminate() {}, async waitForExit() { return true; },
  };
  const runs = [];
  mod.apply({ subagents: { registerProvider: (p) => runs.push(p) }, subprocess: { spawn: () => child } }, {});
  const p1 = runs[0].start({ cwd: process.cwd(), prompt: [{ type: "text", text: "t" }], signal: new AbortController().signal });
  await new Promise((r) => setTimeout(r, 10));
  settleChild();
  const r = await (await p1).result;
  console.log("case1:", r.stopReason, "| diag:", (r.diagnostic || "").slice(0, 90));
  assert.equal(r.stopReason, "error");
  assert.ok(r.diagnostic.includes("cost-cap"));
}

// Case 2: serialization — A (slow) completes before B (fast) even spawns
{
  let spawned = 0, order = [], activeChild = null;
  const mk = (label) => {
    spawned++;
    if (activeChild) throw new Error("TWO CHILDREN AT ONCE — serialization broken");
    activeChild = label;
    return {
      stdin: undefined,
      stdout: { on() {}, off() {}, emit() {} },
      stderr: { on() {}, off() {} },
      done: new Promise((res) => {
        const delay = label === "A" ? 80 : 10;
        setTimeout(() => { order.push(label); activeChild = null; res({ exitCode: 0, signal: null }); }, delay);
      }),
      terminate() {}, async waitForExit() { return true; },
    };
  };
  const runs = [];
  mod.apply({ subagents: { registerProvider: (p) => runs.push(p) }, subprocess: { spawn: (spec) => mk(spec.stdio.stdin.data) } }, {});
  const p = runs[0];
  const ctl = new AbortController();
  const p1 = p.start({ cwd: process.cwd(), prompt: [{ type: "text", text: "A" }], signal: ctl.signal });
  const p2 = p.start({ cwd: process.cwd(), prompt: [{ type: "text", text: "B" }], signal: ctl.signal });
  await (await p1).result; await (await p2).result;
  console.log("case2: spawned =", spawned, "order =", JSON.stringify(order));
  assert.equal(spawned, 2);
  assert.deepEqual(order, ["A", "B"], "A completes before B spawns");
}
console.log("test2.mjs ALL PASS");
