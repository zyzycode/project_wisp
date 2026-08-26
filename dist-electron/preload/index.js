let electron = require("electron");
//#region src/preload/index.ts
electron.contextBridge.exposeInMainWorld("wispAPI", {
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
	setInteractiveBounds: (bounds) => {
		return electron.ipcRenderer.invoke("wisp:set-interactive-bounds", bounds);
	},
	setDragState: (isDragging) => {
		return electron.ipcRenderer.invoke("wisp:set-drag-state", isDragging);
	},
	closeApp: () => {
		return electron.ipcRenderer.invoke("wisp:close-app");
	}
});
//#endregion
