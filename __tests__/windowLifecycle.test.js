const fs = require("fs")
const path = require("path")
const ts = require("typescript")

const sourcePath = path.join(__dirname, "..", "src", "lib", "windowLifecycle.ts")
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, "utf-8"), {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2017
	}
})
const compiledModule = {
	exports: {}
}

new Function("exports", "module", outputText)(compiledModule.exports, compiledModule)

const { shouldHandleQuitAsWindowClose, shouldKeepRunningAfterWindowClose } = compiledModule.exports

test("macOS window close keeps the app running unless an explicit exit is in progress", () => {
	expect(shouldKeepRunningAfterWindowClose("darwin", false)).toBe(true)
	expect(shouldKeepRunningAfterWindowClose("darwin", true)).toBe(false)
})

test("non-macOS window close keeps the existing quit behavior", () => {
	expect(shouldKeepRunningAfterWindowClose("win32", false)).toBe(false)
	expect(shouldKeepRunningAfterWindowClose("linux", false)).toBe(false)
})

test("macOS Command+Q is treated as close-window unless an explicit exit is in progress", () => {
	expect(shouldHandleQuitAsWindowClose("darwin", false)).toBe(true)
	expect(shouldHandleQuitAsWindowClose("darwin", true)).toBe(false)
	expect(shouldHandleQuitAsWindowClose("win32", false)).toBe(false)
})
