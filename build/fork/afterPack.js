/* eslint-disable @typescript-eslint/no-var-requires */
const { execFileSync, spawnSync } = require("child_process")
const path = require("path")
const upstreamAfterPack = require("../afterPack.js").default

/**
 * Fork afterPack: run upstream's checks (bundled rclone present, macOS icon compiled), then ad-hoc sign the app with a
 * STABLE designated requirement.
 *
 * Why: Squirrel.Mac only installs an update whose code signature satisfies the RUNNING app's designated requirement. A
 * plain ad-hoc signature's designated requirement is its own cdhash (`cdhash H"..."`), which every new build changes, so
 * fork updates would always be rejected. Signing the outer bundle with an explicit `identifier "<appId>"` requirement
 * keeps upstream's whole install path (Updater.installUpdate -> quitAndInstall -> ShipIt swap + relaunch) working
 * without a Developer ID or a certificate in anyone's keychain.
 *
 * Trade-off: that requirement accepts any validly signed bundle with this bundle id. Update integrity therefore rests on
 * electron-updater's sha512 check of the zip against latest-mac.yml, both fetched over HTTPS from the fork's GitHub
 * releases - i.e. on who can publish releases to the fork.
 *
 * electron-builder's own signing is off (mac.identity: null), so nothing re-signs the bundle after this hook.
 *
 * @param {import("electron-builder").AfterPackContext} context
 * @returns {Promise<void>}
 */
exports.default = async function forkAfterPack(context) {
	await upstreamAfterPack(context)

	if (context.electronPlatformName !== "darwin") {
		return
	}

	const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
	const identifier = context.packager.appInfo.macBundleIdentifier
	const requirement = `identifier "${identifier}"`

	// 1. Ad-hoc sign all nested code (frameworks, helpers) - each keeps its own cdhash requirement.
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" })
	// 2. Re-sign only the outer bundle, with the stable designated requirement Squirrel.Mac validates updates against.
	execFileSync("codesign", ["--force", "--sign", "-", "--requirements", `=designated => ${requirement}`, appPath], {
		stdio: "inherit"
	})

	// Fail the build rather than ship an update that would be rejected on install.
	execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" })

	const shown = spawnSync("codesign", ["--display", "--requirements", "-", appPath], { encoding: "utf8" })
	const designated = `${shown.stdout}${shown.stderr}`.match(/^designated => (.*)$/m)

	if (!designated || designated[1].trim() !== requirement) {
		throw new Error(`[fork afterPack] unexpected designated requirement: ${designated ? designated[1] : "(none)"}`)
	}

	console.log(`[fork afterPack] ad-hoc signed ${appPath} with designated requirement: ${requirement}`)
}
