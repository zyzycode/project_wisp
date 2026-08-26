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
var LinuxPlatformAdapter = class {
	getPlatformName() {
		return "linux";
	}
	getDisplaySessionType() {
		return process.env.XDG_SESSION_TYPE?.toLowerCase() || "x11";
	}
	configureOverlayWindow(window) {
		window.setAlwaysOnTop(true, "screen-saver");
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}
	setIgnoreMouseEvents(window, ignore, forward = true) {
		try {
			window.setIgnoreMouseEvents(ignore, { forward });
		} catch (err) {
			console.warn("[LinuxPlatformAdapter] setIgnoreMouseEvents warning:", err);
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
			window.setIgnoreMouseEvents(ignore, { forward });
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
			window.setIgnoreMouseEvents(ignore, { forward });
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
var mainWindow = null;
var platformAdapter = createPlatformAdapter();
var positionService = null;
var cursorTrackerInterval = null;
var isCurrentlyIgnoring = false;
var isDraggingState = false;
var interactiveBounds = {
	x: 300,
	y: 300,
	width: 140,
	height: 160
};
function resolvePreloadPath() {
	const jsPath = node_path.default.join(__dirname, "../preload/index.js");
	if (node_fs.default.existsSync(jsPath)) return jsPath;
	const mjsPath = node_path.default.join(__dirname, "../preload/index.mjs");
	if (node_fs.default.existsSync(mjsPath)) return mjsPath;
	return jsPath;
}
function initializeServices() {
	const initialWorkArea = platformAdapter.getDisplayWorkArea();
	const initialX = Math.round(Math.max(50, initialWorkArea.width - 250));
	const initialY = Math.round(Math.max(50, initialWorkArea.height - 250));
	positionService = new PetPositionService({
		x: initialX,
		y: initialY
	});
	interactiveBounds = {
		x: initialX - 20,
		y: initialY - 20,
		width: 160,
		height: 180
	};
}
function startCursorTracking() {
	if (cursorTrackerInterval) clearInterval(cursorTrackerInterval);
	cursorTrackerInterval = setInterval(() => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (isDraggingState) {
			if (isCurrentlyIgnoring) {
				isCurrentlyIgnoring = false;
				platformAdapter.setIgnoreMouseEvents(mainWindow, false);
			}
			return;
		}
		const cursor = electron.screen.getCursorScreenPoint();
		const workArea = platformAdapter.getDisplayWorkArea();
		const relX = cursor.x - workArea.x;
		const relY = cursor.y - workArea.y;
		const isInside = relX >= interactiveBounds.x && relX <= interactiveBounds.x + interactiveBounds.width && relY >= interactiveBounds.y && relY <= interactiveBounds.y + interactiveBounds.height;
		if (isInside && isCurrentlyIgnoring) {
			isCurrentlyIgnoring = false;
			platformAdapter.setIgnoreMouseEvents(mainWindow, false);
		} else if (!isInside && !isCurrentlyIgnoring) {
			isCurrentlyIgnoring = true;
			platformAdapter.setIgnoreMouseEvents(mainWindow, true, true);
		}
	}, 25);
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
			isCurrentlyIgnoring = ignore;
			platformAdapter.setIgnoreMouseEvents(mainWindow, ignore, forward);
		}
	});
	electron.ipcMain.handle("wisp:set-interactive-bounds", async (_event, bounds) => {
		if (bounds && typeof bounds.x === "number" && typeof bounds.y === "number") interactiveBounds = { ...bounds };
	});
	electron.ipcMain.handle("wisp:set-drag-state", async (_event, isDragging) => {
		isDraggingState = Boolean(isDragging);
		if (isDraggingState && mainWindow && !mainWindow.isDestroyed()) {
			isCurrentlyIgnoring = false;
			platformAdapter.setIgnoreMouseEvents(mainWindow, false);
		}
	});
	electron.ipcMain.handle("wisp:get-position", async () => {
		return positionService ? positionService.getPosition() : {
			x: 300,
			y: 300
		};
	});
	electron.ipcMain.handle("wisp:update-position", async (_event, targetPos) => {
		const currentPos = positionService ? positionService.getPosition() : {
			x: 300,
			y: 300
		};
		const safePos = {
			x: typeof targetPos?.x === "number" && Number.isFinite(targetPos.x) ? targetPos.x : currentPos.x,
			y: typeof targetPos?.y === "number" && Number.isFinite(targetPos.y) ? targetPos.y : currentPos.y
		};
		const bounds = platformAdapter.getDisplayWorkArea(safePos);
		const updated = positionService ? positionService.updatePosition(safePos, bounds) : safePos;
		interactiveBounds.x = updated.x - 20;
		interactiveBounds.y = updated.y - 20;
		return updated;
	});
	electron.ipcMain.handle("wisp:get-screen-bounds", async () => {
		return platformAdapter.getDisplayWorkArea();
	});
	electron.ipcMain.handle("wisp:close-app", async () => {
		if (cursorTrackerInterval) {
			clearInterval(cursorTrackerInterval);
			cursorTrackerInterval = null;
		}
		electron.app.quit();
	});
}
function createWindow() {
	const preloadPath = resolvePreloadPath();
	const workArea = platformAdapter.getDisplayWorkArea();
	mainWindow = new electron.BrowserWindow({
		x: workArea.x,
		y: workArea.y,
		width: workArea.width,
		height: workArea.height,
		show: true,
		transparent: true,
		frame: false,
		hasShadow: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		resizable: false,
		webPreferences: {
			preload: preloadPath,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false
		}
	});
	platformAdapter.configureOverlayWindow(mainWindow);
	platformAdapter.setIgnoreMouseEvents(mainWindow, true, true);
	isCurrentlyIgnoring = true;
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://") || url.startsWith("http://")) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
		if (!process.env.VITE_DEV_SERVER_URL && !navigationUrl.startsWith("file://")) event.preventDefault();
	});
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(node_path.default.join(RENDERER_DIST, "index.html"));
	startCursorTracking();
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
		if (cursorTrackerInterval) {
			clearInterval(cursorTrackerInterval);
			cursorTrackerInterval = null;
		}
		if (platformAdapter.getPlatformName() !== "darwin") electron.app.quit();
	});
}
//#endregion
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
