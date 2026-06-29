#!/usr/bin/env node
// Dependency-free static lint for the repo. Two cheap, fast checks that fit the
// "no package.json, no toolchain" philosophy:
//   1. `node --check` every .mjs we own  → catches syntax errors before tests run.
//   2. JSON.parse every .json we own      → catches broken manifests / kit metadata.
// Vendored bundles (canvas-kit/vendor/), node_modules/ and per-user artifacts/ are
// skipped — we don't own them. Run with `node scripts/lint.mjs`.

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "artifacts", "vendor", ".git"]);

function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
		} else {
			yield join(dir, entry.name);
		}
	}
}

const files = [...walk(root)];
const rel = (p) => relative(root, p).split(sep).join("/");

let failures = 0;
const fail = (p, msg) => {
	failures++;
	console.error(`✗ ${rel(p)}: ${msg}`);
};

const mjs = files.filter((f) => f.endsWith(".mjs"));
for (const f of mjs) {
	const res = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
	if (res.status !== 0) fail(f, `syntax error\n${(res.stderr || "").trim()}`);
}

const json = files.filter((f) => f.endsWith(".json"));
for (const f of json) {
	try {
		JSON.parse(readFileSync(f, "utf8"));
	} catch (err) {
		fail(f, `invalid JSON: ${err.message}`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} lint problem(s) found.`);
	process.exit(1);
}

console.log(`✓ lint clean: ${mjs.length} .mjs syntax-checked, ${json.length} .json parsed.`);
