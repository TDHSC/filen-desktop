import { app, net, Notification, shell } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import writeFileAtomic from "write-file-atomic"
import fs from "fs-extra"
import pathModule from "path"
import type FilenDesktop from ".."
import isDev from "../isDev"
import { feedManifestName, parseBaseVersion, parseFeedVersion, upstreamVersionToAnnounce } from "./forkUpdatePolicy"

/**
 * Fork: this build updates from the fork's GitHub releases (build/fork/electron-builder.config.cjs points the publish
 * config there), so the regular Updater + the web UI's update button handle fork releases unchanged. This class adds
 * the other half: a reminder when the OFFICIAL Filen feed is ahead of the fork, i.e. the fork needs a rebase + release.
 */
export const FORK_REPO = "TDHSC/filen-desktop"
export const UPSTREAM_REPO = "FilenCloudDienste/filen-desktop"
export const UPSTREAM_FEED_URL = "https://cdn.filen.io/@filen/desktop/release/latest/"

const STATE_VERSION = 1
const MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000

type ForkUpdatesState = {
	lastAnnouncedUpstreamVersion?: string
}

export class ForkUpdates {
	private readonly desktop: FilenDesktop
	private initialized: boolean = false
	private checking: boolean = false
	private lastCheckAt: number = 0
	// Held so the notification (and its click handler) is not garbage collected while it is on screen.
	private notification: Notification | null = null

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

	public initialize(): void {
		// Off in dev (no updater there either) and in the CI updater E2E, which must not depend on the production CDN.
		if (isDev || this.initialized || process.env.FILEN_E2E_UPDATER === "1") {
			return
		}

		this.initialized = true

		// Piggyback on the Updater's hourly fork feed check instead of running a second timer: its outcome tells whether a
		// fork update is pending, which suppresses the upstream reminder until that update is installed.
		autoUpdater.on("update-available", (info: UpdateInfo) => this.check(info.version))
		autoUpdater.on("update-not-available", () => this.check(null))
		// Fork feed unreachable (or no fork release yet): nothing pending as far as we know.
		autoUpdater.on("error", () => this.check(null))
	}

	/**
	 * @param pendingForkVersion the fork release electron-updater offers, or null when none is pending
	 */
	private check(pendingForkVersion: string | null): void {
		// "error" can follow "update-available" within the same cycle (e.g. a failed download) - one check per cycle.
		if (this.checking || Date.now() - this.lastCheckAt < MIN_CHECK_INTERVAL_MS) {
			return
		}

		this.checking = true
		this.lastCheckAt = Date.now()

		this.checkUpstream(pendingForkVersion)
			.catch(err => {
				this.desktop.logger.log("error", err, "forkUpdates.checkUpstream")
			})
			.finally(() => {
				this.checking = false
			})
	}

	private async checkUpstream(pendingForkVersion: string | null): Promise<void> {
		const response = await net.fetch(`${UPSTREAM_FEED_URL}${feedManifestName(process.platform)}`, {
			cache: "no-store"
		})

		if (!response.ok) {
			throw new Error(`Upstream feed responded with HTTP ${response.status}`)
		}

		const upstreamVersion = parseFeedVersion(await response.text())

		if (!upstreamVersion) {
			throw new Error("Upstream feed has no version")
		}

		const installedVersion = app.getVersion()
		const state = await this.readState()
		const toAnnounce = upstreamVersionToAnnounce({
			upstream: upstreamVersion,
			installed: installedVersion,
			forkUpdatePending: pendingForkVersion !== null,
			lastAnnounced: state.lastAnnouncedUpstreamVersion ?? null
		})

		this.desktop.logger.log(
			"info",
			`Fork update check: upstream ${upstreamVersion}, installed ${installedVersion}, pending fork update ${pendingForkVersion ?? "none"}` +
				(toAnnounce ? ` - announcing upstream ${toAnnounce}` : "")
		)

		if (!toAnnounce) {
			return
		}

		this.announce(toAnnounce, parseBaseVersion(installedVersion)?.join(".") ?? installedVersion)

		await this.writeState({
			...state,
			lastAnnouncedUpstreamVersion: toAnnounce
		})
	}

	private announce(upstreamVersion: string, forkBaseVersion: string): void {
		if (!Notification.isSupported()) {
			this.desktop.logger.log("warn", `Upstream Filen v${upstreamVersion} is available, but notifications are not supported`)

			return
		}

		const notification = new Notification({
			title: `Filen v${upstreamVersion} released upstream`,
			body: `This build is based on v${forkBaseVersion}. Rebase ${FORK_REPO} and publish a fork release to get it. Click for the release notes.`
		})

		notification.on("click", () => {
			shell.openExternal(`https://github.com/${UPSTREAM_REPO}/releases/tag/v${upstreamVersion}`).catch(() => {})
		})

		notification.on("close", () => {
			if (this.notification === notification) {
				this.notification = null
			}
		})

		this.notification = notification

		notification.show()
	}

	private statePath(): string {
		return pathModule.join(app.getPath("userData"), `forkUpdates.v${STATE_VERSION}.json`)
	}

	private async readState(): Promise<ForkUpdatesState> {
		try {
			return JSON.parse(await fs.readFile(this.statePath(), "utf-8"))
		} catch {
			return {}
		}
	}

	private async writeState(state: ForkUpdatesState): Promise<void> {
		await writeFileAtomic(this.statePath(), JSON.stringify(state), "utf-8")
	}
}

export default ForkUpdates
