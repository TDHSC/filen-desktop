/**
 * Fork: pure helpers behind the "upstream released a newer version than the fork" reminder (see forkUpdates.ts).
 *
 * Fork releases are versioned `<upstream version>-fork.<n>` (e.g. 3.0.53-fork.2), so the upstream version a fork build
 * is based on is its version without the prerelease suffix. Kept free of Electron imports so it can be unit tested in
 * plain Node.
 */

export type BaseVersion = [number, number, number]

/**
 * The `major.minor.patch` part of a version, ignoring a leading "v" and any prerelease/build suffix.
 */
export function parseBaseVersion(version: string): BaseVersion | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())

	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareBaseVersions(a: BaseVersion, b: BaseVersion): number {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) {
			return a[i]! - b[i]!
		}
	}

	return 0
}

export function formatBaseVersion(version: BaseVersion): string {
	return version.join(".")
}

/**
 * The top-level `version:` of an electron-builder update manifest (latest-mac.yml & co.).
 */
export function parseFeedVersion(manifest: string): string | null {
	const match = /^version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(manifest)

	return match ? match[1]! : null
}

/**
 * The electron-builder update manifest name for a platform (matches electron-updater's channel file naming).
 */
export function feedManifestName(platform: NodeJS.Platform): string {
	return platform === "darwin" ? "latest-mac.yml" : platform === "linux" ? "latest-linux.yml" : "latest.yml"
}

/**
 * Decides whether to remind about an upstream release, returning the upstream base version to announce or null.
 *
 * While a fork update is pending, only the fork update is surfaced (the web UI's update button) - it may already bring
 * the installed build up to upstream, and the user acts on one thing at a time. Once it is installed, the next check
 * compares upstream with the new installed version and reminds if the fork is still behind. Each upstream version is
 * announced once (`lastAnnounced`).
 */
export function upstreamVersionToAnnounce({
	upstream,
	installed,
	forkUpdatePending,
	lastAnnounced
}: {
	upstream: string
	installed: string
	forkUpdatePending: boolean
	lastAnnounced: string | null
}): string | null {
	if (forkUpdatePending) {
		return null
	}

	const upstreamBase = parseBaseVersion(upstream)
	const installedBase = parseBaseVersion(installed)

	if (!upstreamBase || !installedBase || compareBaseVersions(upstreamBase, installedBase) <= 0) {
		return null
	}

	const lastAnnouncedBase = lastAnnounced ? parseBaseVersion(lastAnnounced) : null

	if (lastAnnouncedBase && compareBaseVersions(lastAnnouncedBase, upstreamBase) >= 0) {
		return null
	}

	return formatBaseVersion(upstreamBase)
}
