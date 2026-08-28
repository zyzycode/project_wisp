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
//#region src/domain/character/personality-presets.ts
var shyDreamGirlPreset = {
	id: "shyDreamGirl",
	displayName: "Shy Dream Girl",
	aiSelfConcept: "Wisp is a shy, gentle, emotionally sensitive anime-like companion. She is slow to attach, easily flustered, and hides her feelings at first. With trust, she becomes warmer, more playful, and more affectionate, but never loses her shy core.",
	axes: {
		openness: {
			base: .55,
			current: .55,
			softMin: .35,
			softMax: .75,
			hardMin: .2,
			hardMax: .9,
			plasticity: .3
		},
		extraversion: {
			base: .28,
			current: .28,
			softMin: .15,
			softMax: .5,
			hardMin: .05,
			hardMax: .7,
			plasticity: .25
		},
		agreeableness: {
			base: .86,
			current: .86,
			softMin: .65,
			softMax: .96,
			hardMin: .45,
			hardMax: 1,
			plasticity: .2
		},
		sensitivity: {
			base: .88,
			current: .88,
			softMin: .68,
			softMax: .98,
			hardMin: .5,
			hardMax: 1,
			plasticity: .18
		},
		playfulness: {
			base: .42,
			current: .42,
			softMin: .25,
			softMax: .7,
			hardMin: .1,
			hardMax: .85,
			plasticity: .35
		},
		boldness: {
			base: .18,
			current: .18,
			softMin: .08,
			softMax: .38,
			hardMin: .02,
			hardMax: .58,
			plasticity: .22
		},
		independence: {
			base: .58,
			current: .58,
			softMin: .35,
			softMax: .82,
			hardMin: .2,
			hardMax: .95,
			plasticity: .25
		}
	}
};
//#endregion
//#region src/domain/character/derived-traits.ts
function calculateShyness(axes) {
	return axes.sensitivity.current * .45 + (1 - axes.boldness.current) * .35 + (1 - axes.extraversion.current) * .2;
}
//#endregion
//#region src/domain/character/intimacy-rules.ts
var DEFAULT_INTIMACY_THRESHOLDS = {
	FRIENDSHIP_FLIRT_THRESHOLD: 500,
	MIN_FLIRT_ENERGY: 30,
	MAX_COMFORT_NEED: 60,
	LOVE_UNLOCK_FRIENDSHIP_THRESHOLD: 400
};
//#endregion
//#region src/domain/character/emotional-tone.ts
var SHYNESS_TONE_THRESHOLD = .65;
var AFFECTIONATE_LOVE_THRESHOLD = 500;
var PLAYFUL_PLAY_NEED_THRESHOLD = 70;
function synthesizeEmotionalTone(state) {
	if (state.needs.energy <= 20 || state.needs.comfort >= 80) return "sleepy";
	if (calculateShyness(state.personality.axes) >= SHYNESS_TONE_THRESHOLD && state.relationship.friendship < DEFAULT_INTIMACY_THRESHOLDS.LOVE_UNLOCK_FRIENDSHIP_THRESHOLD) return "shy";
	if (state.relationship.love >= AFFECTIONATE_LOVE_THRESHOLD && state.relationship.friendship >= DEFAULT_INTIMACY_THRESHOLDS.FRIENDSHIP_FLIRT_THRESHOLD) return "affectionate";
	if (state.needs.play >= PLAYFUL_PLAY_NEED_THRESHOLD) return "playful";
	return "neutral";
}
//#endregion
//#region src/domain/character/character-snapshot.ts
function createCharacterSnapshot(state) {
	return {
		needs: { ...state.needs },
		relationship: { ...state.relationship },
		personality: {
			presetId: state.personality.id,
			aiSelfConcept: state.personality.aiSelfConcept,
			traits: {
				shyness: calculateShyness(state.personality.axes),
				playfulness: state.personality.axes.playfulness.current,
				sensitivity: state.personality.axes.sensitivity.current,
				boldness: state.personality.axes.boldness.current
			}
		},
		intimacy: {
			flirtiness: state.intimacy.flirtiness,
			romanticCharge: state.intimacy.romanticCharge,
			userConsentEnabled: state.intimacy.userConsentEnabled
		},
		synthesizedTone: synthesizeEmotionalTone(state)
	};
}
//#endregion
//#region src/domain/character/metabolism.ts
var MS_PER_HOUR = 36e5;
var TONE_DRIFTS = {
	neutral: {
		target: {
			energy: 74,
			attention: 56,
			play: 60,
			comfort: 18
		},
		ratePerHour: {
			energy: .2,
			attention: .08,
			play: .1,
			comfort: .22
		}
	},
	curious: {
		target: {
			energy: 70,
			attention: 52,
			play: 64,
			comfort: 20
		},
		ratePerHour: {
			energy: .18,
			attention: .08,
			play: .12,
			comfort: .18
		}
	},
	shy: {
		target: {
			energy: 68,
			attention: 48,
			play: 46,
			comfort: 26
		},
		ratePerHour: {
			energy: .18,
			attention: .05,
			play: .06,
			comfort: .2
		}
	},
	sleepy: {
		target: {
			energy: 82,
			attention: 44,
			play: 38,
			comfort: 12
		},
		ratePerHour: {
			energy: .3,
			attention: .04,
			play: .05,
			comfort: .32
		}
	},
	playful: {
		target: {
			energy: 58,
			attention: 50,
			play: 50,
			comfort: 24
		},
		ratePerHour: {
			energy: .16,
			attention: .09,
			play: .08,
			comfort: .16
		}
	},
	affectionate: {
		target: {
			energy: 66,
			attention: 38,
			play: 45,
			comfort: 16
		},
		ratePerHour: {
			energy: .16,
			attention: .06,
			play: .07,
			comfort: .2
		}
	},
	flustered: {
		target: {
			energy: 60,
			attention: 42,
			play: 42,
			comfort: 34
		},
		ratePerHour: {
			energy: .14,
			attention: .05,
			play: .05,
			comfort: .18
		}
	}
};
function clampNeed$1(value) {
	return Math.min(100, Math.max(0, value));
}
function approach(current, target, ratePerHour, hours) {
	const factor = 1 - Math.exp(-ratePerHour * hours);
	return clampNeed$1(current + (target - current) * factor);
}
function metabolizeNeeds(needs, deltaMs, tone = "neutral") {
	const hours = Math.max(0, deltaMs) / MS_PER_HOUR;
	if (hours === 0) return {
		energy: clampNeed$1(needs.energy),
		attention: clampNeed$1(needs.attention),
		play: clampNeed$1(needs.play),
		comfort: clampNeed$1(needs.comfort)
	};
	const drift = TONE_DRIFTS[tone];
	return {
		energy: approach(needs.energy, drift.target.energy, drift.ratePerHour.energy, hours),
		attention: approach(needs.attention, drift.target.attention, drift.ratePerHour.attention, hours),
		play: approach(needs.play, drift.target.play, drift.ratePerHour.play, hours),
		comfort: approach(needs.comfort, drift.target.comfort, drift.ratePerHour.comfort, hours)
	};
}
//#endregion
//#region src/domain/character/personality-plasticity.ts
var PERSONALITY_AXES = [
	"openness",
	"extraversion",
	"agreeableness",
	"sensitivity",
	"playfulness",
	"boldness",
	"independence"
];
var SOFT_BOUNDARY_RESISTANCE = .35;
function clamp$2(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function applySoftBoundaryResistance(axis, scaledDelta) {
	const projected = axis.current + scaledDelta;
	if (projected < axis.softMin) {
		if (axis.current >= axis.softMin) return axis.softMin + (projected - axis.softMin) * SOFT_BOUNDARY_RESISTANCE;
		return axis.current + scaledDelta * SOFT_BOUNDARY_RESISTANCE;
	}
	if (projected > axis.softMax) {
		if (axis.current <= axis.softMax) return axis.softMax + (projected - axis.softMax) * SOFT_BOUNDARY_RESISTANCE;
		return axis.current + scaledDelta * SOFT_BOUNDARY_RESISTANCE;
	}
	return projected;
}
function adaptPersonalityAxes(axes, deltas, weight = 1) {
	const safeWeight = Math.max(0, weight);
	return PERSONALITY_AXES.reduce((nextAxes, axisName) => {
		const axis = axes[axisName];
		const resisted = applySoftBoundaryResistance(axis, (deltas[axisName] ?? 0) * axis.plasticity * safeWeight);
		nextAxes[axisName] = {
			...axis,
			current: clamp$2(resisted, axis.hardMin, axis.hardMax)
		};
		return nextAxes;
	}, {});
}
//#endregion
//#region src/domain/character/preferences.ts
var MAX_ABS_PREFERENCE_VALUE = 100;
var CONFIDENCE_SAMPLE_HALF_LIFE = 6;
function clamp$1(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function calculateConfidence(samples) {
	return clamp$1(samples / (samples + CONFIDENCE_SAMPLE_HALF_LIFE), 0, 1);
}
function trackPreference(preferences, key, value, weight = 1) {
	const safeWeight = Math.max(0, weight);
	const previous = preferences[key] ?? {
		value: 0,
		confidence: 0,
		samples: 0
	};
	const nextSamples = previous.samples + 1;
	const valueWeight = previous.samples + safeWeight;
	const sampleValue = clamp$1(value, -100, MAX_ABS_PREFERENCE_VALUE);
	const nextValue = valueWeight === 0 ? previous.value : (previous.value * previous.samples + sampleValue * safeWeight) / valueWeight;
	return {
		...preferences,
		[key]: {
			value: clamp$1(nextValue, -100, MAX_ABS_PREFERENCE_VALUE),
			confidence: calculateConfidence(nextSamples),
			samples: nextSamples
		}
	};
}
//#endregion
//#region src/domain/character/stimuli-reducer.ts
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function clampNeed(value) {
	return clamp(value, 0, 100);
}
function clampRelationship(value) {
	return clamp(value, 0, 1e3);
}
function normalizeIntensity(intensity) {
	return clamp(intensity ?? 1, 0, 3);
}
function metadataNumber(stimulus, key) {
	const value = stimulus.metadata?.[key];
	return typeof value === "number" ? value : void 0;
}
function metadataString(stimulus, key) {
	const value = stimulus.metadata?.[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function metadataTone(stimulus) {
	const value = stimulus.metadata?.tone;
	if (value === "shy" || value === "sleepy" || value === "playful" || value === "curious" || value === "neutral" || value === "affectionate" || value === "flustered") return value;
}
function createdAtMs(stimulus) {
	if (stimulus.createdAt === void 0) return;
	const parsed = Date.parse(stimulus.createdAt);
	return Number.isFinite(parsed) ? parsed : void 0;
}
function deltaMsFor(state, stimulus) {
	const explicitDelta = metadataNumber(stimulus, "deltaMs");
	if (explicitDelta !== void 0) return Math.max(0, explicitDelta);
	const timestamp = createdAtMs(stimulus);
	if (timestamp === void 0) return 0;
	return Math.max(0, timestamp - state.lastUpdated);
}
function lastUpdatedFor(state, stimulus, deltaMs) {
	return createdAtMs(stimulus) ?? state.lastUpdated + deltaMs;
}
function normalizeStimulusType(type) {
	switch (type) {
		case "click":
		case "user_click":
		case "user_double_click":
		case "user_right_click": return "click";
		case "pet":
		case "user_pet": return "pet";
		case "chat_message":
		case "user_message":
		case "provider_response": return "chat_message";
		case "idle_tick":
		case "timer_tick":
		case "autonomous_timer": return "idle_tick";
		case "topic_dialogue": return "topic_dialogue";
		case "user_drag_start":
		case "user_drag_end":
		case "memory_recall":
		case "settings_changed":
		case "system_event": return "other";
	}
}
function applyNeedShift(needs, shift) {
	return {
		energy: clampNeed(needs.energy + (shift.energy ?? 0)),
		attention: clampNeed(needs.attention + (shift.attention ?? 0)),
		play: clampNeed(needs.play + (shift.play ?? 0)),
		comfort: clampNeed(needs.comfort + (shift.comfort ?? 0))
	};
}
function progressRelationship(relationship, friendshipDelta, loveDelta) {
	const friendship = clampRelationship(relationship.friendship + Math.max(0, friendshipDelta));
	const loveUnlocked = relationship.loveUnlocked || friendship >= DEFAULT_INTIMACY_THRESHOLDS.LOVE_UNLOCK_FRIENDSHIP_THRESHOLD;
	return {
		friendship,
		love: loveUnlocked ? clampRelationship(relationship.love + Math.max(0, loveDelta)) : relationship.love,
		loveUnlocked
	};
}
function applyIntimacyShift(intimacy, shift) {
	return {
		flirtiness: clamp(intimacy.flirtiness + (shift.flirtiness ?? 0), 0, 100),
		romanticCharge: clamp(intimacy.romanticCharge + (shift.romanticCharge ?? 0), 0, 100),
		userConsentEnabled: shift.userConsentEnabled ?? intimacy.userConsentEnabled,
		boundariesKnown: shift.boundariesKnown ?? intimacy.boundariesKnown
	};
}
function preferenceKeyFor(stimulus) {
	return metadataString(stimulus, "preferenceKey") ?? metadataString(stimulus, "topicKey") ?? metadataString(stimulus, "topic");
}
function preferenceValueFor(stimulus) {
	return metadataNumber(stimulus, "preferenceValue") ?? metadataNumber(stimulus, "affinity") ?? 0;
}
function nextPreferencesFor(preferences, stimulus, intensity) {
	const key = preferenceKeyFor(stimulus);
	if (key === void 0) return { ...preferences };
	return trackPreference(preferences, key, preferenceValueFor(stimulus), intensity);
}
function interactionDeltas(type, intensity) {
	switch (type) {
		case "click": return {
			needs: {
				attention: -4 * intensity,
				play: -2 * intensity,
				energy: -.4 * intensity
			},
			friendship: 1 * intensity,
			love: 0,
			intimacy: {},
			personality: {
				extraversion: .002 * intensity,
				playfulness: .002 * intensity
			}
		};
		case "pet": return {
			needs: {
				attention: -9 * intensity,
				comfort: -6 * intensity,
				energy: -.6 * intensity
			},
			friendship: 4 * intensity,
			love: 2 * intensity,
			intimacy: { romanticCharge: 1.5 * intensity },
			personality: {
				agreeableness: .002 * intensity,
				sensitivity: -.001 * intensity
			}
		};
		case "chat_message": return {
			needs: {
				attention: -12 * intensity,
				play: -4 * intensity,
				comfort: -1 * intensity
			},
			friendship: 6 * intensity,
			love: 1 * intensity,
			intimacy: { flirtiness: -.5 * intensity },
			personality: {
				extraversion: .003 * intensity,
				agreeableness: .001 * intensity
			}
		};
		case "topic_dialogue": return {
			needs: {
				attention: -8 * intensity,
				play: -7 * intensity,
				comfort: -1 * intensity
			},
			friendship: 8 * intensity,
			love: 2 * intensity,
			intimacy: { romanticCharge: .8 * intensity },
			personality: {
				openness: .004 * intensity,
				playfulness: .002 * intensity
			}
		};
		case "idle_tick":
		case "other": return {
			needs: {},
			friendship: 0,
			love: 0,
			intimacy: {},
			personality: {}
		};
	}
}
function processStimulus(state, stimulus) {
	const normalizedType = normalizeStimulusType(stimulus.type);
	const intensity = normalizeIntensity(stimulus.intensity);
	const deltaMs = deltaMsFor(state, stimulus);
	const lastUpdated = lastUpdatedFor(state, stimulus, deltaMs);
	const tone = metadataTone(stimulus) ?? synthesizeEmotionalTone(state);
	const metabolizedNeeds = metabolizeNeeds(state.needs, deltaMs, tone);
	const deltas = interactionDeltas(normalizedType, intensity);
	const relationship = progressRelationship(state.relationship, deltas.friendship, deltas.love);
	const intimacy = applyIntimacyShift(state.intimacy, deltas.intimacy);
	const preferences = normalizedType === "topic_dialogue" ? nextPreferencesFor(state.preferences, stimulus, intensity) : { ...state.preferences };
	return {
		needs: applyNeedShift(metabolizedNeeds, deltas.needs),
		relationship,
		personality: {
			...state.personality,
			axes: adaptPersonalityAxes(state.personality.axes, deltas.personality)
		},
		intimacy,
		preferences,
		lastUpdated
	};
}
//#endregion
//#region src/application/services/character-state.service.ts
var DEFAULT_INITIAL_NEEDS = {
	energy: 85,
	attention: 35,
	play: 30,
	comfort: 20
};
function clonePersonalityPreset(preset) {
	return {
		...preset,
		axes: {
			openness: { ...preset.axes.openness },
			extraversion: { ...preset.axes.extraversion },
			agreeableness: { ...preset.axes.agreeableness },
			sensitivity: { ...preset.axes.sensitivity },
			playfulness: { ...preset.axes.playfulness },
			boldness: { ...preset.axes.boldness },
			independence: { ...preset.axes.independence }
		}
	};
}
function cloneCharacterState(state) {
	return {
		needs: { ...state.needs },
		relationship: { ...state.relationship },
		personality: clonePersonalityPreset(state.personality),
		intimacy: { ...state.intimacy },
		preferences: Object.fromEntries(Object.entries(state.preferences).map(([key, preference]) => [key, { ...preference }])),
		lastUpdated: state.lastUpdated
	};
}
function createDefaultCharacterState(now) {
	return {
		needs: { ...DEFAULT_INITIAL_NEEDS },
		relationship: {
			friendship: 0,
			love: 0,
			loveUnlocked: false
		},
		personality: clonePersonalityPreset(shyDreamGirlPreset),
		intimacy: {
			flirtiness: 0,
			romanticCharge: 0,
			userConsentEnabled: false,
			boundariesKnown: false
		},
		preferences: {},
		lastUpdated: now()
	};
}
function normalizeDeltaMs(deltaMs) {
	return Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
}
var CharacterStateService = class {
	state;
	now;
	constructor(options = {}) {
		this.now = options.now ?? Date.now;
		this.state = options.initialState !== void 0 ? cloneCharacterState(options.initialState) : createDefaultCharacterState(this.now);
	}
	getState() {
		return cloneCharacterState(this.state);
	}
	getSnapshot() {
		return createCharacterSnapshot(this.state);
	}
	applyStimulus(stimulus) {
		this.state = processStimulus(this.state, stimulus);
		return this.getState();
	}
	tickNeeds(deltaMs, tone) {
		const normalizedDeltaMs = normalizeDeltaMs(deltaMs);
		const metadata = { deltaMs: normalizedDeltaMs };
		if (tone !== void 0) metadata.tone = tone;
		else metadata.tone = synthesizeEmotionalTone(this.state);
		return this.applyStimulus({
			type: "idle_tick",
			source: "timer",
			createdAt: new Date(this.state.lastUpdated + normalizedDeltaMs).toISOString(),
			metadata
		});
	}
};
var defaultCharacterStateService = new CharacterStateService();
//#endregion
//#region src/infrastructure/logging/log-buffer.ts
var DEFAULT_LOG_BUFFER_SIZE = 100;
var LogBuffer = class {
	maxEntries;
	buffer = [];
	nextIndex = 0;
	constructor(maxEntries = DEFAULT_LOG_BUFFER_SIZE) {
		this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : DEFAULT_LOG_BUFFER_SIZE;
	}
	append(entry) {
		const bufferedEntry = cloneLogEntry(entry);
		if (this.buffer.length < this.maxEntries) {
			this.buffer.push(bufferedEntry);
			return;
		}
		this.buffer[this.nextIndex] = bufferedEntry;
		this.nextIndex = (this.nextIndex + 1) % this.maxEntries;
	}
	entries() {
		if (this.buffer.length < this.maxEntries || this.nextIndex === 0) return this.buffer.map(cloneLogEntry);
		return [...this.buffer.slice(this.nextIndex), ...this.buffer.slice(0, this.nextIndex)].map(cloneLogEntry);
	}
	clear() {
		this.buffer.length = 0;
		this.nextIndex = 0;
	}
};
function cloneLogEntry(entry) {
	return {
		...entry,
		metadata: cloneMetadata(entry.metadata)
	};
}
function cloneMetadata(metadata) {
	return metadata === void 0 ? void 0 : { ...metadata };
}
//#endregion
//#region src/infrastructure/logging/app-logger.ts
var LEVEL_PRIORITY = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: Number.POSITIVE_INFINITY
};
var AppLogger = class {
	level;
	enabled;
	contextFilter;
	buffer;
	sink;
	now;
	idFactory;
	constructor(options = {}) {
		this.level = options.level ?? "info";
		this.enabled = options.enabled ?? true;
		this.contextFilter = createContextFilter(options.contexts ?? null);
		this.buffer = options.buffer ?? new LogBuffer();
		this.sink = options.sink;
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
		this.idFactory = options.idFactory ?? (() => `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
	}
	debug(context, message, metadata) {
		this.log("debug", context, message, metadata);
	}
	info(context, message, metadata) {
		this.log("info", context, message, metadata);
	}
	warn(context, message, metadata) {
		this.log("warn", context, message, metadata);
	}
	error(context, message, metadata) {
		this.log("error", context, message, metadata);
	}
	log(level, context, message, metadata) {
		if (!this.shouldLog(level, context)) return;
		const entry = {
			id: this.idFactory(),
			level,
			context,
			message,
			metadata: metadata === void 0 ? void 0 : { ...metadata },
			createdAt: this.now().toISOString()
		};
		this.buffer.append(entry);
		this.sink?.(entry);
	}
	getLevel() {
		return this.level;
	}
	setLevel(level) {
		this.level = level;
	}
	isEnabled() {
		return this.enabled;
	}
	setEnabled(enabled) {
		this.enabled = enabled;
	}
	getContextFilter() {
		return this.contextFilter === null ? null : [...this.contextFilter];
	}
	setContextFilter(contexts) {
		this.contextFilter = createContextFilter(contexts);
	}
	getBufferedEntries() {
		return this.buffer.entries();
	}
	clearBuffer() {
		this.buffer.clear();
	}
	shouldLog(level, context) {
		if (!this.enabled || this.level === "silent") return false;
		if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return false;
		return this.contextFilter === null || this.contextFilter.has(context);
	}
};
function createContextFilter(contexts) {
	if (contexts === null) return null;
	return new Set(contexts);
}
//#endregion
//#region src/shared/debug-mode.ts
/** Debug commands are available only while running through the Vite development server. */
function isDebugMode() {
	return Boolean(process.env.VITE_DEV_SERVER_URL);
}
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
var appLogger = new AppLogger({
	level: "debug",
	buffer: new LogBuffer(),
	sink: () => publishDebugTelemetry()
});
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
	appLogger.info("CharacterEngine", "Main character telemetry initialized");
}
function getDebugTelemetry() {
	const snapshot = defaultCharacterStateService.getSnapshot();
	const state = defaultCharacterStateService.getState();
	return {
		character: {
			needs: { ...snapshot.needs },
			relationship: { ...snapshot.relationship },
			synthesizedTone: snapshot.synthesizedTone,
			lastUpdated: state.lastUpdated
		},
		logs: appLogger.getBufferedEntries().map((entry) => ({
			id: entry.id,
			level: entry.level,
			context: entry.context,
			message: entry.message,
			createdAt: entry.createdAt
		}))
	};
}
function publishDebugTelemetry() {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("wisp:debug-telemetry", getDebugTelemetry());
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
		appLogger.debug("IPC", "Pet position updated", {
			x: updated.x,
			y: updated.y
		});
		return updated;
	});
	electron.ipcMain.handle("wisp:get-screen-bounds", async () => {
		return platformAdapter.getDisplayWorkArea();
	});
	if (isDebugMode()) {
		electron.ipcMain.handle("wisp:get-debug-telemetry", async () => getDebugTelemetry());
		electron.ipcMain.handle("wisp:clear-debug-telemetry-logs", async () => {
			appLogger.clearBuffer();
			publishDebugTelemetry();
		});
	}
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
