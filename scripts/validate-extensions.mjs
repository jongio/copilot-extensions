#!/usr/bin/env node
// Validates every folder in extensions/ is a well-formed Copilot extension.
// Dependency-free; run with `node scripts/validate-extensions.mjs`.

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extensions");

let failures = 0;
const fail = (name, msg) => {
	failures++;
	console.error(`✗ ${name}: ${msg}`);
};

if (!existsSync(extDir)) {
	console.error("No extensions/ directory found.");
	process.exit(1);
}

const entries = readdirSync(extDir).filter((n) => statSync(join(extDir, n)).isDirectory());

if (entries.length === 0) {
	console.error("extensions/ has no extension folders.");
	process.exit(1);
}

for (const name of entries) {
	const dir = join(extDir, name);

	if (!existsSync(join(dir, "extension.mjs"))) {
		fail(name, "missing extension.mjs");
	}

	const manifestPath = join(dir, "copilot-extension.json");
	if (!existsSync(manifestPath)) {
		fail(name, "missing copilot-extension.json");
		continue;
	}

	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (!manifest.name) fail(name, "copilot-extension.json has no name");
		else if (manifest.name !== name) {
			fail(name, `manifest name "${manifest.name}" != folder "${name}"`);
		}
	} catch (err) {
		fail(name, `copilot-extension.json is not valid JSON: ${err.message}`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} problem(s) found.`);
	process.exit(1);
}

console.log(`✓ ${entries.length} extension(s) valid: ${entries.join(", ")}`);
