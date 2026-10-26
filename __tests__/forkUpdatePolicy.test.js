const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

// Transpile the Electron-free TS module on the fly so the test runs in plain Node.
const sourcePath = path.join(__dirname, "..", "src", "lib", "forkUpdatePolicy.ts")
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, "utf-8"), {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020
	}
})
const compiledModule = { exports: {} }

new Function("exports", "module", "require", outputText)(compiledModule.exports, compiledModule, require)

const { parseBaseVersion, parseFeedVersion, feedManifestName, upstreamVersionToAnnounce } = compiledModule.exports

test("parseBaseVersion strips the v prefix and the fork/prerelease suffix", () => {
	assert.deepEqual(parseBaseVersion("3.0.53"), [3, 0, 53])
	assert.deepEqual(parseBaseVersion("v3.0.53-fork.2"), [3, 0, 53])
	assert.deepEqual(parseBaseVersion("3.0.49-rc9"), [3, 0, 49])
	assert.equal(parseBaseVersion("not-a-version"), null)
})

test("parseFeedVersion reads the top-level version of an update manifest", () => {
	const manifest = [
		"minimumSystemVersion: 21.0.0",
		"version: 3.0.53",
		"files:",
		"  - url: Filen_mac_arm64.zip",
		"    sha512: abc",
		"    size: 1"
	].join("\n")

	assert.equal(parseFeedVersion(manifest), "3.0.53")
	assert.equal(parseFeedVersion("version: '3.0.54'\n"), "3.0.54")
	assert.equal(parseFeedVersion("files: []\n"), null)
})

test("feedManifestName matches electron-updater channel files", () => {
	assert.equal(feedManifestName("darwin"), "latest-mac.yml")
	assert.equal(feedManifestName("linux"), "latest-linux.yml")
	assert.equal(feedManifestName("win32"), "latest.yml")
})

test("announces an upstream release the installed fork build has not caught up with", () => {
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.54", installed: "3.0.53-fork.1", forkUpdatePending: false, lastAnnounced: null }),
		"3.0.54"
	)
})

test("stays quiet when upstream is not ahead of the installed build", () => {
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.53", installed: "3.0.53-fork.1", forkUpdatePending: false, lastAnnounced: null }),
		null
	)
})

test("only the fork update is surfaced while one is pending, even if upstream is further ahead", () => {
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.55", installed: "3.0.53-fork.1", forkUpdatePending: true, lastAnnounced: null }),
		null
	)
})

test("after the fork update is installed, reminds if the fork is still behind upstream", () => {
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.55", installed: "3.0.54-fork.1", forkUpdatePending: false, lastAnnounced: null }),
		"3.0.55"
	)
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.55", installed: "3.0.55-fork.1", forkUpdatePending: false, lastAnnounced: null }),
		null
	)
})

test("announces each upstream version only once", () => {
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.54", installed: "3.0.53-fork.1", forkUpdatePending: false, lastAnnounced: "3.0.54" }),
		null
	)
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "3.0.55", installed: "3.0.53-fork.1", forkUpdatePending: false, lastAnnounced: "3.0.54" }),
		"3.0.55"
	)
})

test("ignores unparsable versions instead of announcing", () => {
	assert.equal(
		upstreamVersionToAnnounce({ upstream: "garbage", installed: "3.0.53-fork.1", forkUpdatePending: false, lastAnnounced: null }),
		null
	)
})
