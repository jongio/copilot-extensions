#!/usr/bin/env node
// Runs every extension smoke test (extensions/<name>/test/*.test.mjs) in its own
// Node process and reports a roll-up. Dependency-free; run with `node scripts/run-tests.mjs`.
// Each test is self-contained (boots its extension's kit runtime over loopback HTTP,
// no SDK, no network), so this is just a discover-and-spawn loop.

import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extensions");

if (!existsSync(extDir)) {
	console.error("No extensions/ directory found.");
	process.exit(1);
}

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const tests = [];
for (const name of readdirSync(extDir).filter((n) => isDir(join(extDir, n)))) {
	const testDir = join(extDir, name, "test");
	if (!isDir(testDir)) continue;
	for (const f of readdirSync(testDir).filter((f) => f.endsWith(".test.mjs"))) {
		tests.push(join(testDir, f));
	}
}

if (tests.length === 0) {
	console.error("No *.test.mjs files found under extensions/*/test/.");
	process.exit(1);
}

let failures = 0;
for (const t of tests.sort()) {
	const rel = t.slice(root.length + 1).replace(/\\/g, "/");
	console.log(`\n── ${rel} ──`);
	const res = spawnSync(process.execPath, [t], { stdio: "inherit" });
	if (res.status !== 0) {
		failures++;
		console.error(`✗ ${rel} failed (exit ${res.status})`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} of ${tests.length} test file(s) failed.`);
	process.exit(1);
}

console.log(`\n✓ ${tests.length} test file(s) passed.`);
