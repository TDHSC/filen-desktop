/* eslint-disable @typescript-eslint/no-var-requires */
// Fork: electron-builder config for TDHSC/filen-desktop releases (macOS arm64, ad-hoc signed).
//
// Starts from upstream's package.json "build" config and overrides only what the fork needs, so upstream build changes
// flow in on rebase without touching this file:
// - publish: the fork's GitHub releases. electron-builder bakes this into the app's app-update.yml, which is what points
//   the unchanged Updater (and the web UI's update button) at fork releases instead of the official CDN.
// - version: FILEN_FORK_VERSION, "<upstream version>-fork.<n>". Injected via extraMetadata so package.json keeps
//   upstream's version line (no conflict on every upstream version bump). Required: a build carrying the plain upstream
//   version would sort ABOVE every "-fork.<n>" release of that version (semver prerelease rules) and never update.
// - detectUpdateChannel: false, otherwise the "-fork.<n>" prerelease makes electron-builder write fork-mac.yml instead of
//   the latest-mac.yml electron-updater fetches.
// - signing: no Developer ID / notarization (identity null); afterPack.js ad-hoc signs with a stable designated
//   requirement instead - see there for why Squirrel.Mac needs it.
// - targets: arm64 only (the only Mac the fork ships to).

const pkg = require("../../package.json")
const forkAfterPack = require("./afterPack.js")

const FORK_PUBLISH = [
	{
		provider: "github",
		owner: "TDHSC",
		repo: "filen-desktop"
	}
]

const version = process.env.FILEN_FORK_VERSION

if (!version || !/^\d+\.\d+\.\d+-fork\.\d+$/.test(version)) {
	throw new Error(`FILEN_FORK_VERSION must be set to "<upstream version>-fork.<n>" (got ${JSON.stringify(version)})`)
}

if (!version.startsWith(`${pkg.version}-fork.`)) {
	throw new Error(`FILEN_FORK_VERSION ${version} is not based on the upstream version in package.json (${pkg.version})`)
}

module.exports = {
	...pkg.build,
	extraMetadata: {
		...(pkg.build.extraMetadata || {}),
		version
	},
	detectUpdateChannel: false,
	publish: FORK_PUBLISH,
	afterPack: forkAfterPack.default,
	// notarize-dmg.js notarizes the dmg with Apple credentials the fork does not have.
	afterAllArtifactBuild: null,
	mac: {
		...pkg.build.mac,
		identity: null,
		notarize: false,
		hardenedRuntime: false,
		target: [
			{
				target: "dmg",
				arch: ["arm64"]
			},
			{
				target: "zip",
				arch: ["arm64"]
			}
		],
		publish: FORK_PUBLISH
	}
}
