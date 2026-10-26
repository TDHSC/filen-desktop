const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

// Transpile the (type-only-importing) TS module on the fly so the test runs in plain Node without Electron.
const sourcePath = path.join(__dirname, "..", "src", "lib", "macAppMenu.ts")
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, "utf-8"), {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020
	}
})
const compiledModule = { exports: {} }

new Function("exports", "module", "require", outputText)(compiledModule.exports, compiledModule, require)

const { buildMacAppMenuTemplate } = compiledModule.exports

const flatten = items => items.flatMap(item => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])

test("Cmd+Q hides the window instead of quitting", () => {
	let hidden = 0
	const items = flatten(buildMacAppMenuTemplate("Filen", () => hidden++))
	const cmdQ = items.filter(item => item.accelerator === "Command+Q")

	assert.equal(cmdQ.length, 1)
	assert.equal(cmdQ[0].role, undefined)

	cmdQ[0].click()

	assert.equal(hidden, 1)
})

test("no menu item quits the app", () => {
	const items = flatten(buildMacAppMenuTemplate("Filen", () => {}))

	assert.equal(
		items.some(item => item.role === "quit"),
		false
	)
})

test("keeps the default Edit/View/Window menus (copy/paste shortcuts depend on the Edit menu)", () => {
	const roles = buildMacAppMenuTemplate("Filen", () => {}).map(item => item.role)

	assert.deepEqual(roles.slice(1), ["fileMenu", "editMenu", "viewMenu", "windowMenu"])
})
