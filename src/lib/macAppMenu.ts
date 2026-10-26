import type { MenuItemConstructorOptions } from "electron"

/**
 * Fork: the macOS application menu. Identical to Electron's default menu, except that the Cmd+Q item hides the main
 * window instead of quitting.
 *
 * Only the keyboard shortcut is remapped - app.quit() itself is never intercepted - so every genuine quit still goes
 * through the normal before-quit -> will-quit teardown: the tray "Exit", the updater, IPC restart, `osascript quit`
 * and, importantly, system logout/shutdown (blocking before-quit would make Filen cancel a logout).
 *
 * Kept free of runtime Electron imports so it can be unit tested in plain Node.
 */
export function buildMacAppMenuTemplate(appName: string, hideWindow: () => void): MenuItemConstructorOptions[] {
	return [
		{
			label: appName,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{
					label: "Hide Window",
					accelerator: "Command+Q",
					click: () => hideWindow()
				}
			]
		},
		{ role: "fileMenu" },
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" }
	]
}
