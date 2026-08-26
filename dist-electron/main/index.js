Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let node_path = require("node:path");
node_path = __toESM(node_path);
let node_fs = require("node:fs");
node_fs = __toESM(node_fs);
//#region src/infrastructure/platform/linux-platform.adapter.ts
/**
* LinuxPlatformAdapter handles platform-specific window features for Linux.
*
* Linux Window Manager & Protocol Considerations:
* 1. X11 / XWayland:
*    - Native `BrowserWindow.setPosition()` and `setAlwaysOnTop(true, 'floating')` are fully supported.
*    - Transparency is managed by X11 compositors (Mutter, KWin, Picom).
*
* 2. Pure Native Wayland:
*    - The Wayland security protocol restricts client applications from setting arbitrary global screen coordinates.
*    - Electron on Linux defaults to XWayland unless explicitly run with Ozone Wayland flags.
*    - Under native Wayland, if `setPosition()` is constrained by the compositor, the window safely remains at its
*      initial position without throwing unhandled exceptions.
*/
var LinuxPlatformAdapter = class {
	getPlatformName() {
		return "linux";
	}
	getDisplaySessionType() {
		return process.env.XDG_SESSION_TYPE?.toLowerCase() || "x11";
	}
	configureOverlayWindow(window) {
		window.setAlwaysOnTop(true, "floating");
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}
	setIgnoreMouseEvents(window, ignore, forward = true) {
		try {
			if (ignore) window.setIgnoreMouseEvents(true, { forward });
			else window.setIgnoreMouseEvents(false);
		} catch (err) {
			console.warn("[LinuxPlatformAdapter] setIgnoreMouseEvents warning:", err);
		}
	}
	getDisplayWorkArea(point) {
		try {
			const { x, y, width, height } = (point ? electron.screen.getDisplayNearestPoint(point) : electron.screen.getPrimaryDisplay()).workArea;
			return {
				x,
				y,
				width,
				height
			};
		} catch {
			const primary = electron.screen.getPrimaryDisplay();
			return {
				x: 0,
				y: 0,
				width: primary?.workArea?.width || 1920,
				height: primary?.workArea?.height || 1080
			};
		}
	}
};
//#endregion
//#region src/infrastructure/platform/windows-platform.adapter.ts
var WindowsPlatformAdapter = class {
	getPlatformName() {
		return "win32";
	}
	getDisplaySessionType() {
		return "dwm";
	}
	configureOverlayWindow(window) {
		window.setAlwaysOnTop(true, "screen-saver");
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}
	setIgnoreMouseEvents(window, ignore, forward = true) {
		try {
			if (ignore) window.setIgnoreMouseEvents(true, { forward });
			else window.setIgnoreMouseEvents(false);
		} catch (err) {
			console.warn("[WindowsPlatformAdapter] setIgnoreMouseEvents warning:", err);
		}
	}
	getDisplayWorkArea(point) {
		const { x, y, width, height } = (point ? electron.screen.getDisplayNearestPoint(point) : electron.screen.getPrimaryDisplay()).workArea;
		return {
			x,
			y,
			width,
			height
		};
	}
};
//#endregion
//#region src/infrastructure/platform/macos-platform.adapter.ts
var MacOSPlatformAdapter = class {
	getPlatformName() {
		return "darwin";
	}
	getDisplaySessionType() {
		return "cocoa";
	}
	configureOverlayWindow(window) {
		window.setAlwaysOnTop(true, "floating");
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}
	setIgnoreMouseEvents(window, ignore, forward = true) {
		try {
			if (ignore) window.setIgnoreMouseEvents(true, { forward });
			else window.setIgnoreMouseEvents(false);
		} catch (err) {
			console.warn("[MacOSPlatformAdapter] setIgnoreMouseEvents warning:", err);
		}
	}
	getDisplayWorkArea(point) {
		const { x, y, width, height } = (point ? electron.screen.getDisplayNearestPoint(point) : electron.screen.getPrimaryDisplay()).workArea;
		return {
			x,
			y,
			width,
			height
		};
	}
};
//#endregion
//#region src/infrastructure/platform/platform-adapter.factory.ts
function createPlatformAdapter() {
	switch (process.platform) {
		case "linux": return new LinuxPlatformAdapter();
		case "win32": return new WindowsPlatformAdapter();
		case "darwin": return new MacOSPlatformAdapter();
		default:
			console.warn(`[PlatformAdapterFactory] Unrecognized platform "${process.platform}", falling back to Linux adapter.`);
			return new LinuxPlatformAdapter();
	}
}
//#endregion
//#region src/domain/models/position.ts
/**
* Clamps a 2D position so that the pet bounding box stays strictly inside the screen work area.
*/
function clampPositionToBounds(targetPos, petSize, screenBounds) {
	const minX = screenBounds.x;
	const maxX = Math.max(minX, screenBounds.x + screenBounds.width - petSize.width);
	const minY = screenBounds.y;
	const maxY = Math.max(minY, screenBounds.y + screenBounds.height - petSize.height);
	return {
		x: Math.round(Math.min(Math.max(targetPos.x, minX), maxX)),
		y: Math.round(Math.min(Math.max(targetPos.y, minY), maxY))
	};
}
//#endregion
//#region src/application/services/pet-position.service.ts
var PetPositionService = class {
	currentPosition;
	petSize = {
		width: 100,
		height: 100
	};
	constructor(initialPosition) {
		this.currentPosition = initialPosition ?? {
			x: 300,
			y: 300
		};
	}
	getPosition() {
		return { ...this.currentPosition };
	}
	getPetSize() {
		return { ...this.petSize };
	}
	setPetSize(size) {
		this.petSize = { ...size };
	}
	updatePosition(target, bounds) {
		const clamped = clampPositionToBounds(target, this.petSize, bounds);
		this.currentPosition = clamped;
		return this.currentPosition;
	}
};
//#endregion
//#region src/main/index.ts
process.env.APP_ROOT = node_path.default.join(__dirname, "../..");
var MAIN_DIST = node_path.default.join(process.env.APP_ROOT, "dist-electron");
var RENDERER_DIST = node_path.default.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL ? node_path.default.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
var WINDOW_WIDTH = 280;
var WINDOW_HEIGHT = 320;
var mainWindow = null;
var platformAdapter = createPlatformAdapter();
var positionService = null;
function resolvePreloadPath() {
	const jsPath = node_path.default.join(__dirname, "../preload/index.js");
	if (node_fs.default.existsSync(jsPath)) return jsPath;
	const mjsPath = node_path.default.join(__dirname, "../preload/index.mjs");
	if (node_fs.default.existsSync(mjsPath)) return mjsPath;
	return jsPath;
}
function calculateInitialPosition() {
	const workArea = platformAdapter.getDisplayWorkArea();
	return {
		x: Math.round(workArea.x + Math.max(20, workArea.width - 280 - 60)),
		y: Math.round(workArea.y + Math.max(20, workArea.height - 320 - 60))
	};
}
function initializeServices() {
	positionService = new PetPositionService(calculateInitialPosition());
	positionService.setPetSize({
		width: 280,
		height: 320
	});
}
function registerIpcHandlers() {
	electron.ipcMain.handle("wisp:ping", async (_event, message) => {
		return {
			reply: `Pong: ${typeof message === "string" ? message : ""}`,
			timestamp: Date.now()
		};
	});
	electron.ipcMain.handle("wisp:get-system-info", async () => {
		return {
			platform: platformAdapter.getPlatformName(),
			sessionType: platformAdapter.getDisplaySessionType(),
			appVersion: electron.app.getVersion(),
			electronVersion: process.versions.electron || "unknown",
			chromeVersion: process.versions.chrome || "unknown",
			nodeVersion: process.versions.node || "unknown"
		};
	});
	electron.ipcMain.handle("wisp:set-ignore-mouse-events", async (_event, payload) => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			const ignore = Boolean(payload?.ignore);
			const forward = payload?.forward ?? true;
			platformAdapter.setIgnoreMouseEvents(mainWindow, ignore, forward);
		}
	});
	electron.ipcMain.handle("wisp:set-interactive-bounds", async (_event, _bounds) => {});
	electron.ipcMain.handle("wisp:set-drag-state", async (_event, _isDragging) => {});
	electron.ipcMain.handle("wisp:get-position", async () => {
		return positionService ? positionService.getPosition() : calculateInitialPosition();
	});
	electron.ipcMain.handle("wisp:update-position", async (_event, targetPos) => {
		const currentPos = positionService ? positionService.getPosition() : calculateInitialPosition();
		const safePos = {
			x: typeof targetPos?.x === "number" && Number.isFinite(targetPos.x) ? targetPos.x : currentPos.x,
			y: typeof targetPos?.y === "number" && Number.isFinite(targetPos.y) ? targetPos.y : currentPos.y
		};
		const bounds = platformAdapter.getDisplayWorkArea(safePos);
		const updated = positionService ? positionService.updatePosition(safePos, bounds) : safePos;
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setPosition(Math.round(updated.x), Math.round(updated.y));
		return updated;
	});
	electron.ipcMain.handle("wisp:get-screen-bounds", async () => {
		return platformAdapter.getDisplayWorkArea();
	});
	electron.ipcMain.handle("wisp:close-app", async () => {
		electron.app.quit();
	});
}
function createWindow() {
	const preloadPath = resolvePreloadPath();
	const initialPos = calculateInitialPosition();
	mainWindow = new electron.BrowserWindow({
		x: initialPos.x,
		y: initialPos.y,
		width: 280,
		height: 320,
		show: true,
		transparent: true,
		frame: false,
		hasShadow: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		minimizable: false,
		resizable: false,
		webPreferences: {
			preload: preloadPath,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			contextIsolation: true,
			sandbox: true,
			backgroundThrottling: false,
			webSecurity: true,
			allowRunningInsecureContent: false
		}
	});
	platformAdapter.configureOverlayWindow(mainWindow);
	mainWindow.on("minimize", () => {
		mainWindow?.restore();
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
		if (!process.env.VITE_DEV_SERVER_URL && !navigationUrl.startsWith("file://")) event.preventDefault();
	});
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(node_path.default.join(RENDERER_DIST, "index.html"));
}
if (!electron.app.requestSingleInstanceLock()) electron.app.quit();
else {
	electron.app.on("second-instance", () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});
	electron.app.whenReady().then(() => {
		initializeServices();
		registerIpcHandlers();
		createWindow();
		electron.app.on("activate", () => {
			if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});
	electron.app.on("window-all-closed", () => {
		if (platformAdapter.getPlatformName() !== "darwin") electron.app.quit();
	});
}
//#endregion
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.WINDOW_HEIGHT = WINDOW_HEIGHT;
exports.WINDOW_WIDTH = WINDOW_WIDTH;
