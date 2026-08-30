let electron = require("electron");
//#region src/shared/debug-mode.ts
/** Debug commands are available only while running through the Vite development server. */
function isDebugMode() {
	return Boolean(process.env.VITE_DEV_SERVER_URL);
}
//#endregion
//#region src/preload/index.ts
var api = {
	debugEnabled: isDebugMode(),
	ping: (message) => {
		return electron.ipcRenderer.invoke("wisp:ping", message);
	},
	getSystemInfo: () => {
		return electron.ipcRenderer.invoke("wisp:get-system-info");
	},
	setIgnoreMouseEvents: (payload) => {
		return electron.ipcRenderer.invoke("wisp:set-ignore-mouse-events", payload);
	},
	getPosition: () => {
		return electron.ipcRenderer.invoke("wisp:get-position");
	},
	updatePosition: (pos) => {
		return electron.ipcRenderer.invoke("wisp:update-position", pos);
	},
	getScreenBounds: () => {
		return electron.ipcRenderer.invoke("wisp:get-screen-bounds");
	},
	getEnvironmentSnapshot: () => {
		return electron.ipcRenderer.invoke("wisp:get-environment-snapshot");
	},
	onEnvironmentChanged: (callback) => {
		const handler = (_event, snapshot) => callback(snapshot);
		electron.ipcRenderer.on("wisp:environment-changed", handler);
		return () => {
			electron.ipcRenderer.removeListener("wisp:environment-changed", handler);
		};
	},
	interactWithCharacter: (interaction) => {
		return electron.ipcRenderer.invoke("wisp:character-interact", interaction);
	},
	setAlwaysOnTop: (enabled) => {
		return electron.ipcRenderer.invoke("wisp:set-always-on-top", enabled);
	},
	setInteractiveBounds: (bounds) => {
		return electron.ipcRenderer.invoke("wisp:set-interactive-bounds", bounds);
	},
	setDragState: (isDragging) => {
		return electron.ipcRenderer.invoke("wisp:set-drag-state", isDragging);
	},
	setMenuExpanded: (expanded) => {
		return electron.ipcRenderer.invoke("wisp:set-menu-expanded", expanded);
	},
	...isDebugMode() ? {
		getDebugTelemetry: () => electron.ipcRenderer.invoke("wisp:get-debug-telemetry"),
		clearDebugTelemetryLogs: () => electron.ipcRenderer.invoke("wisp:clear-debug-telemetry-logs"),
		onDebugTelemetry: (listener) => {
			const handler = (_event, telemetry) => listener(telemetry);
			electron.ipcRenderer.on("wisp:debug-telemetry", handler);
			return () => {
				electron.ipcRenderer.removeListener("wisp:debug-telemetry", handler);
			};
		}
	} : {},
	closeApp: () => {
		return electron.ipcRenderer.invoke("wisp:close-app");
	}
};
electron.contextBridge.exposeInMainWorld("wispAPI", api);
//#endregion
