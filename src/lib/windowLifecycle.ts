export function shouldKeepRunningAfterWindowClose(platform: NodeJS.Platform, shouldExitOnQuit: boolean): boolean {
	return platform === "darwin" && !shouldExitOnQuit
}

export function shouldHandleQuitAsWindowClose(platform: NodeJS.Platform, shouldExitOnQuit: boolean): boolean {
	return platform === "darwin" && !shouldExitOnQuit
}
