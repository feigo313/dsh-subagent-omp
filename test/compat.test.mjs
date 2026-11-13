// Contract: a DeepSeek Harness upgrade inside a supported line must not stop
// this bundle from mounting. The host gates activation on the manifest's
// `engines.dsh` range (when present it decides alone and peerDependencies are
// ignored), matched with prerelease-aware semver ordering. An exact pin here
// means every `-rc.N` bump silently drops the `subagent_omp` tool row.
//
// Failure mode if this regresses: after a DSH upgrade the plugin reports
// `incompatible-version`, `cordis.patch.yml` rows never mount, and
// delegations through `subagent_omp` disappear with no other symptom.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function parseVersion(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value);
	assert.ok(match, `not a semver version: ${value}`);
	return {
		numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4] === undefined ? undefined : match[4].split("."),
	};
}

// Mirrors node-semver ordering, including the rule that a prerelease sorts
// below its own release.
function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	for (let index = 0; index < 3; index += 1) {
		if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1;
	}
	if (a.prerelease === undefined && b.prerelease === undefined) return 0;
	if (a.prerelease === undefined) return 1;
	if (b.prerelease === undefined) return -1;
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
		const x = a.prerelease[index];
		const y = b.prerelease[index];
		if (x === undefined) return y === undefined ? 0 : -1;
		if (y === undefined) return x === undefined ? 0 : 1;
		const numericX = /^\d+$/.test(x);
		const numericY = /^\d+$/.test(y);
		if (numericX && numericY) {
			if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
		} else if (numericX !== numericY) {
			return numericX ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

// Supports the `>=A <B` comparator pair this manifest uses, evaluated with
// prereleases admitted the way the host does (`includePrerelease: true`).
function satisfiesRange(version, range) {
	const comparators = range.trim().split(/\s+/);
	assert.equal(comparators.length, 2, `this test only understands ">=A <B", got: ${range}`);
	const [lower, upper] = comparators;
	assert.ok(lower.startsWith(">="), `expected a ">=A" lower bound, got: ${lower}`);
	assert.ok(upper.startsWith("<"), `expected a "<B" upper bound, got: ${upper}`);
	return compareVersions(version, lower.slice(2)) >= 0 && compareVersions(version, upper.slice(1)) < 0;
}

test("engines.dsh carries the compatibility decision, not an exact pin", () => {
	assert.equal(typeof manifest.engines?.dsh, "string", "manifest must declare engines.dsh");
	assert.ok(
		!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.engines.dsh.trim()),
		`engines.dsh must be a range, not an exact version (it would break on the next rc): ${manifest.engines.dsh}`,
	);
});

test("the range admits later releases and prereleases of a supported line", () => {
	// `0.3.0-rc.1` sorts below `0.3.0`, so the host's prerelease-aware matching
	// admits the next line's release candidates while the stable release of that
	// line still requires an explicit compatibility check here.
	for (const version of ["0.2.2-rc.1", "0.2.2-rc.2", "0.2.2-rc.3", "0.2.2-rc.9", "0.2.2", "0.2.3", "0.2.9-rc.1", "0.3.0-rc.1"]) {
		assert.ok(
			satisfiesRange(version, manifest.engines.dsh),
			`DSH ${version} must satisfy engines.dsh (${manifest.engines.dsh}), or the tool row will not mount`,
		);
	}
});

test("the range refuses the boundary where the seam contract may change", () => {
	for (const version of ["0.1.9", "0.2.2-rc.0", "0.3.0", "0.4.0"]) {
		assert.ok(
			!satisfiesRange(version, manifest.engines.dsh),
			`DSH ${version} must be refused by engines.dsh (${manifest.engines.dsh})`,
		);
	}
});
