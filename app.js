(() => {
  "use strict";

  const DB_NAME = "sentinel-cctv";
  const DB_VERSION = 1;
  const MAX_ACTIVE_STREAMS = 4;
  const CHUNK_MS = 60_000;
  const MAX_ANALYTICS_EVENTS = 5_000;
  const STORAGE_WARNING = 0.82;
  const STORAGE_LIMIT = 0.9;
  const AUTH_KEY = "sentinel.pin.v1";
  const ACCESS_LOG_KEY = "sentinel.access-log.v1";
  const ADMIN_ONLY_ACTIONS = new Set([
    "add-camera", "edit-camera", "delete-camera", "snapshot", "toggle-recording",
    "connect-camera", "disconnect-camera", "activate-video", "add-event", "event-detail",
    "sync-analytics", "refresh-storage", "cleanup-recordings", "play-session", "view-snapshot",
    "delete-snapshot", "delete-session", "export-data", "reset-app", "layout-edit",
    "move-camera", "camera-size", "delete-user", "delete-zone", "draw-zone", "save-access",
    "copy-user-link", "test-alarm", "cancel-zone",
  ]);
  const SETTINGS_KEY = "sentinel.settings.v1";
  const DEFAULT_SETTINGS = {
    gatewayUrl: "",
    analyticsUrl: "",
    maxStreams: MAX_ACTIVE_STREAMS,
    autoLockMinutes: 10,
    retentionDays: 7,
    voiceEnabled: false,
    muted: false,
    gridMode: "grid",
    analyticsPollSeconds: 30,
    zonesEnabled: false,
    zoneSensitivity: 18,
    alarmVoiceEnabled: true,
    alarmToneEnabled: true,
    alarmWebhookUrl: "",
    maintenanceEnabled: false,
    maintenanceMessage: "Service Maintenance — viewing is temporarily unavailable. Please try again later.",
  };
  const SYMBOLS = {
    grid: "▦", analytics: "◷", recordings: "◉", settings: "⚙",
    cameras: "▣", event: "⌁", snapshot: "▧", lock: "⌑", add: "+",
  };
  const state = {
    view: "grid", cameras: [], events: [], sessions: [], snapshots: [],
    settings: loadSettings(), selectedCameraId: "", analyticsFilter: "all",
    search: "", auth: "checking", authStep: "setup", firstPin: "",
    setupUsername: "admin", authUsername: new URLSearchParams(location.search).get("user") || "", currentUser: null, accounts: [],
    accessLog: [], layoutEditMode: false, zoneDrawingCameraId: "", zoneDraft: null, zoneNameDraft: "",
    pinInput: "", modal: null, mute: false, storage: null, recording: null,
    analyticsBusy: false, analyticsLastSync: 0,
  };
  const media = new Map();
  const root = document.getElementById("app");
  let db;
  let idleTimer;
  let analyticsTimer;
  let usageTimer;
  let zoneMonitorTimer;
  let lastUsageTick = 0;
  let audioContext;
  const zoneSamples = new Map();
  const zoneAlarmAt = new Map();
  const zoneHitCounts = new Map();
  let zoneCanvas;
  let zoneCanvasContext;
  let zoneCanvasWarning = false;
  const unavailableZoneCameras = new Set();
  let authFailures = 0;
  let lockoutUntil = 0;
  let focusBeforeModal = null;
  let authError = "";
  let recordingWriteChain = Promise.resolve();
  const finalizingReasons = new Map();
  let storageWarningAt = 0;
  let usagePersistWarningAt = 0;
  let suppressNextZoneClick = false;
  const speechQueue = [];
  const spokenKeys = new Set();
  let speechInProgress = false;

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const settings = { ...DEFAULT_SETTINGS, ...saved };
      if (![1,2,3,4,5,6,7,8,9].includes(Number(settings.maxStreams))) settings.maxStreams = DEFAULT_SETTINGS.maxStreams;
      if (![0,1,5,10,15,30,60].includes(Number(settings.autoLockMinutes))) settings.autoLockMinutes = DEFAULT_SETTINGS.autoLockMinutes;
      if (![1,3,7,14,30,90].includes(Number(settings.retentionDays))) settings.retentionDays = DEFAULT_SETTINGS.retentionDays;
      if (![15,30,60,300].includes(Number(settings.analyticsPollSeconds))) settings.analyticsPollSeconds = DEFAULT_SETTINGS.analyticsPollSeconds;
      settings.maxStreams = Number(settings.maxStreams);
      settings.autoLockMinutes = Number(settings.autoLockMinutes);
      settings.retentionDays = Number(settings.retentionDays);
      settings.analyticsPollSeconds = Number(settings.analyticsPollSeconds);
      settings.zoneSensitivity = Number(settings.zoneSensitivity);
      settings.gatewayUrl = String(settings.gatewayUrl || "").slice(0, 500);
      settings.analyticsUrl = String(settings.analyticsUrl || "").slice(0, 1000);
      settings.voiceEnabled = Boolean(settings.voiceEnabled);
      settings.muted = Boolean(settings.muted);
      settings.zonesEnabled = Boolean(settings.zonesEnabled);
      settings.alarmVoiceEnabled = Boolean(settings.alarmVoiceEnabled);
      settings.alarmToneEnabled = Boolean(settings.alarmToneEnabled);
      settings.maintenanceEnabled = Boolean(settings.maintenanceEnabled);
      settings.maintenanceMessage = String(settings.maintenanceMessage || DEFAULT_SETTINGS.maintenanceMessage).slice(0, 240);
      settings.alarmWebhookUrl = String(settings.alarmWebhookUrl || "").slice(0, 1000);
      if (![8, 12, 18, 25, 35, 50].includes(settings.zoneSensitivity)) settings.zoneSensitivity = DEFAULT_SETTINGS.zoneSensitivity;
      return settings;
    } catch (error) {
      console.error("Settings could not be read:", error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function safeRestrictedZones(camera) {
    if (!Array.isArray(camera?.restrictedZones)) return [];
    return camera.restrictedZones.filter((zone) =>
      zone && typeof zone.id === "string" && [zone.x, zone.y, zone.width, zone.height].every(Number.isFinite)
      && zone.x >= 0 && zone.y >= 0 && zone.width > 0 && zone.height > 0
      && zone.x + zone.width <= 1.001 && zone.y + zone.height <= 1.001);
  }

  async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function activeCameraCard(target) {
    return target instanceof Element && target.matches(".camera-card");
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      return true;
    } catch (error) {
      notify("Settings could not be saved in this browser.", "error");
      console.error("Settings persistence failed:", error);
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function id(prefix) {
    return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Browser storage transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Browser storage transaction was cancelled."));
    });
  }

  async function openDatabase() {
    if (!("indexedDB" in window)) throw new Error("IndexedDB is unavailable in this browser.");
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const cameras = database.createObjectStore("cameras", { keyPath: "id" });
      cameras.createIndex("sortOrder", "sortOrder");
      const chunks = database.createObjectStore("chunks", { keyPath: "id" });
      chunks.createIndex("sessionId", "sessionId");
      chunks.createIndex("cameraStarted", ["cameraId", "startedAt"]);
      chunks.createIndex("startedAt", "startedAt");
      const sessions = database.createObjectStore("sessions", { keyPath: "id" });
      sessions.createIndex("startedAt", "startedAt");
      sessions.createIndex("cameraId", "cameraId");
      const events = database.createObjectStore("events", { keyPath: "id" });
      events.createIndex("occurredAt", "occurredAt");
      events.createIndex("cameraId", "cameraId");
      events.createIndex("category", "category");
      const snapshots = database.createObjectStore("snapshots", { keyPath: "id" });
      snapshots.createIndex("capturedAt", "capturedAt");
      snapshots.createIndex("cameraId", "cameraId");
    };
    request.onblocked = () => notify("Close another Sentinel tab to finish the storage update.", "warning");
    return requestResult(request);
  }

  async function dbAll(storeName) {
    return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
  }

  async function dbPut(storeName, value) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    await transactionDone(tx);
  }

  async function dbDelete(storeName, key) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    await transactionDone(tx);
  }

  async function dbGet(storeName, key) {
    return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
  }

  async function seedCameras() {
    const existing = await dbAll("cameras");
    if (existing.length) {
      state.cameras = existing.sort((a, b) => a.sortOrder - b.sortOrder);
      return;
    }
    state.cameras = [
      { id: id("cam"), name: "Front Entrance", location: "North perimeter", streamKey: "front_entrance", substreamKey: "front_entrance_sub", enabled: true, sortOrder: 0 },
      { id: id("cam"), name: "Loading Bay", location: "Service access", streamKey: "loading_bay", substreamKey: "loading_bay_sub", enabled: true, sortOrder: 1 },
      { id: id("cam"), name: "Parking Level 1", location: "West garage", streamKey: "parking_level_1", substreamKey: "parking_level_1_sub", enabled: true, sortOrder: 2 },
    ];
    const tx = db.transaction("cameras", "readwrite");
    state.cameras.forEach((camera) => tx.objectStore("cameras").put(camera));
    await transactionDone(tx);
  }

  function formatDate(value, includeSeconds = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
      ...(includeSeconds ? { second: "2-digit" } : {}),
    }).format(date);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function notify(message, type = "success", duration = 4200) {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("role", "status");
      stack.setAttribute("aria-live", "polite");
      document.body.append(stack);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : type === "warning" ? "warning" : ""}`;
    toast.textContent = message;
    stack.append(toast);
    window.setTimeout(() => toast.remove(), duration);
  }

  function cameraById(cameraId) {
    return state.cameras.find((camera) => camera.id === cameraId);
  }

  function isAdmin() {
    return state.currentUser?.role === "admin";
  }

  function currentViewerAccount() {
    return state.accounts.find((account) => account.username === state.currentUser?.username && account.role === "user");
  }

  function camerasForAccount(account) {
    const enabledCameras = state.cameras.filter((camera) => camera.enabled !== false);
    if (!Array.isArray(account?.cameraIds)) return enabledCameras;
    const allowed = new Set(account.cameraIds.filter((cameraId) => typeof cameraId === "string"));
    return enabledCameras.filter((camera) => allowed.has(camera.id));
  }

  function camerasVisibleToCurrentUser() {
    return isAdmin() ? state.cameras.filter((camera) => camera.enabled !== false) : camerasForAccount(currentViewerAccount());
  }

  function ensureCameraSelectionForCurrentUser() {
    const allowedCameras = camerasVisibleToCurrentUser();
    if (!allowedCameras.some((camera) => camera.id === state.selectedCameraId)) {
      state.selectedCameraId = allowedCameras[0]?.id || "";
    }
  }

  function assignedCameraIdsFromForm(values) {
    const knownIds = new Set(state.cameras.map((camera) => camera.id));
    return [...new Set(values.getAll("cameraIds").map(String))].filter((cameraId) => knownIds.has(cameraId));
  }

  function renderCameraAssignmentOptions(name, assignedCameraIds = []) {
    const assigned = new Set(assignedCameraIds);
    return state.cameras.filter((camera) => camera.enabled !== false).map((camera) =>
      `<label class="camera-assignment"><input type="checkbox" name="${name}" value="${escapeHtml(camera.id)}" ${assigned.has(camera.id) ? "checked" : ""}><span><strong>${escapeHtml(camera.name)}</strong><small>${escapeHtml(camera.location || camera.streamKey)}</small></span></label>`
    ).join("") || `<p class="panel-description">No enabled cameras are configured yet.</p>`;
  }

  function viewerAccessStatus(account = currentViewerAccount(), now = Date.now()) {
    if (!account) return { allowed: false, reason: "account", message: "This viewer account is no longer available. Please contact the administrator." };
    if (account.enabled === false) return { allowed: false, reason: "disabled", message: account.accessMessage || "Service Maintenance — viewing has been paused by the administrator." };
    if (state.settings.maintenanceEnabled) return { allowed: false, reason: "maintenance", message: state.settings.maintenanceMessage };
    const expiration = account.subscriptionExpiresAt ? new Date(account.subscriptionExpiresAt).getTime() : 0;
    if (account.subscriptionExpiresAt && (!Number.isFinite(expiration) || expiration <= now)) {
      return { allowed: false, reason: "expired", message: "Your subscription has ended. Please renew to continue viewing.", expiration };
    }
    const limit = Number(account.dailyLimitMinutes || 0);
    if (limit > 0) {
      const today = localDayKey(now);
      const used = account.usageDay === today ? Math.max(0, Number(account.usedSeconds) || 0) : 0;
      if (used >= limit * 60) return { allowed: false, reason: "limit", message: "Your daily viewing time has been used. Your access will renew at local midnight." };
    }
    return { allowed: true, reason: "", message: "", expiration };
  }

  function formatUsageTime(seconds) {
    const totalMinutes = Math.max(0, Math.ceil(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
  }

  function formatCountdown(milliseconds) {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return days ? `${days}d ${hours}h` : `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  function toLocalDateTimeInput(value) {
    if (!value) return "";
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "";
    const local = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function localDayKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function updateViewerUsage() {
    const now = Date.now();
    const elapsed = lastUsageTick ? Math.min(30, Math.max(0, (now - lastUsageTick) / 1000)) : 0;
    lastUsageTick = now;
    if (!state.currentUser || isAdmin() || state.auth !== "unlocked" || document.visibilityState !== "visible") return false;
    const account = currentViewerAccount();
    if (!account || !viewerAccessStatus(account, now).allowed) return false;
    const today = localDayKey(now);
    if (account.usageDay !== today) {
      account.usageDay = today;
      account.usedSeconds = 0;
    }
    const limitSeconds = Number(account.dailyLimitMinutes || 0) * 60;
    const usedSeconds = Math.max(0, Number(account.usedSeconds) || 0);
    account.usedSeconds = usedSeconds + (limitSeconds ? Math.min(elapsed, Math.max(0, limitSeconds - usedSeconds)) : elapsed);
    try {
      persistAccounts();
    } catch (error) {
      console.error("Viewer usage could not be persisted:", error);
      if (now - usagePersistWarningAt > 60_000) {
        usagePersistWarningAt = now;
        notify("Usage could not be saved; the daily limit may not be reliable in this browser.", "error");
      }
    }
    return true;
  }

  function refreshViewerAccess() {
    try {
      const latest = readAuthRecord();
      if (latest) state.accounts = latest.accounts;
      state.settings = loadSettings();
    } catch (error) {
      console.error("Viewer access policy could not be refreshed:", error);
      notify("Current access rules could not be refreshed from this browser.", "error");
    }
    updateViewerUsage();
    if (state.auth !== "unlocked" || !state.currentUser || isAdmin()) return;
    if (document.visibilityState !== "visible") return;
    ensureCameraSelectionForCurrentUser();
    const status = viewerAccessStatus();
    if (!status.allowed) {
      state.zoneDrawingCameraId = "";
      for (const cameraId of [...media.keys()]) closeCamera(cameraId);
    }
    render();
  }

  function scheduleViewerUsage() {
    clearInterval(usageTimer);
    lastUsageTick = Date.now();
    if (!state.currentUser || isAdmin()) return;
    usageTimer = window.setInterval(refreshViewerAccess, 15_000);
  }

  function validateWebUrl(value, label, required = false) {
    const text = String(value || "").trim();
    if (!text) {
      if (required) throw new Error(`${label} is required.`);
      return "";
    }
    const url = new URL(text, location.href);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${label} must be an HTTP(S) URL without embedded credentials.`);
    }
    if (location.protocol === "https:" && url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
    return url.toString();
  }

  function requireAdmin() {
    if (isAdmin()) return true;
    notify("This action is available to administrators only.", "warning");
    return false;
  }

  function readAuthRecord() {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version === 1 && saved.algorithm === "SHA-256" && saved.salt && saved.digest) {
      const migrated = {
        version: 2,
        accounts: [{
          username: "admin",
          role: "admin",
          salt: saved.salt,
          digest: saved.digest,
          createdAt: new Date().toISOString(),
        }],
      };
      localStorage.setItem(AUTH_KEY, JSON.stringify(migrated));
      return migrated;
    }
    if (saved.version !== 2 || !Array.isArray(saved.accounts) || !saved.accounts.length) {
      throw new Error("Saved local account data is invalid. Reset the local accounts to continue.");
    }
    for (const account of saved.accounts) {
      if (!/^[a-z0-9._-]{3,32}$/.test(account.username) || !["admin", "user"].includes(account.role)
        || !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{64}$/.test(account.digest)) {
        throw new Error("Saved local account data is invalid. Reset the local accounts to continue.");
      }
    }
    return saved;
  }

  function persistAccounts() {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ version: 2, accounts: state.accounts }));
  }

  function recordAccess(username, role, result) {
    const entry = {
      timestamp: new Date().toISOString(),
      username: String(username || "unknown").slice(0, 32),
      role: role === "admin" || role === "user" ? role : "unknown",
      result,
    };
    state.accessLog = [entry, ...state.accessLog].slice(0, 100);
    try {
      localStorage.setItem(ACCESS_LOG_KEY, JSON.stringify(state.accessLog));
    } catch (error) {
      console.error("Local access log could not be saved:", error);
    }
  }

  function loadAccessLog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ACCESS_LOG_KEY) || "[]");
      state.accessLog = Array.isArray(parsed) ? parsed.filter((entry) =>
        entry && typeof entry.timestamp === "string" && typeof entry.username === "string"
        && ["admin", "user", "unknown"].includes(entry.role)
        && ["success", "failed"].includes(entry.result)).slice(0, 100) : [];
    } catch (error) {
      state.accessLog = [];
      console.error("Local access log could not be read:", error);
    }
  }

  function updateCamera(cameraId, patch) {
    const camera = cameraById(cameraId);
    if (!camera) return;
    Object.assign(camera, patch);
    dbPut("cameras", camera).catch((error) => {
      notify("Camera status could not be saved locally.", "error");
      console.error(error);
    });
    updateCameraIndicators();
  }

  function pageInfo() {
    return {
      grid: ["Live Cameras", "Monitor connected camera streams and device health."],
      analytics: ["Event Analytics", "Review locally cached and integrated detection events."],
      recordings: ["Recordings", "Browse locally saved clips and manage storage."],
      settings: ["System Settings", "Configure the gateway, cameras, retention, and alerts."],
    }[state.view] || ["Security Command", ""];
  }

  function navButton(view, label, icon, count = "") {
    return `<button class="nav-item ${state.view === view ? "active" : ""}" data-action="navigate" data-view="${view}" aria-current="${state.view === view ? "page" : "false"}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ""}</button>`;
  }

  function getCameraConnection(cameraId) {
    return media.get(cameraId)?.status || "idle";
  }

  function renderCameraNavigation() {
    return camerasVisibleToCurrentUser().map((camera, index) => {
      const status = getCameraConnection(camera.id);
      const dot = status === "connected" ? "live" : status === "error" ? "error" : "";
      return `<button class="camera-nav" data-action="select-camera" data-camera="${escapeHtml(camera.id)}" title="${escapeHtml(camera.name)}"><span class="camera-dot ${dot}"></span><span>${String(index + 1).padStart(2, "0")}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(camera.name)}</span></button>`;
    }).join("");
  }

  function renderTile(camera, index) {
    const session = media.get(camera.id);
    const status = session?.status || "idle";
    const live = status === "connected";
    const selected = camera.id === state.selectedCameraId;
    const layoutSize = ["standard", "wide", "large"].includes(camera.layoutSize) ? camera.layoutSize : "standard";
    const label = live ? "LIVE" : status === "connecting" ? "CONNECTING" : status === "error" ? "OFFLINE" : "NOT CONNECTED";
    const zones = safeRestrictedZones(camera).filter((zone) => zone.enabled !== false);
    return `<article data-layout-size="${layoutSize}" class="camera-card ${selected ? "selected" : ""}" tabindex="0" role="group" aria-label="${escapeHtml(camera.name)} camera, ${label.toLowerCase()}" data-action="focus-camera" data-camera="${escapeHtml(camera.id)}">
      <div class="video-stage" data-stage="${escapeHtml(camera.id)}">
        <video playsinline muted autoplay data-video="${escapeHtml(camera.id)}" class="${live ? "visible" : ""}" aria-label="${escapeHtml(camera.name)} live video"></video>
        <div class="stage-placeholder" data-placeholder="${escapeHtml(camera.id)}">
          <div class="placeholder-inner"><div class="placeholder-symbol" aria-hidden="true">◉</div><div class="placeholder-state">${escapeHtml(session?.message || label)}</div></div>
        </div>
        ${zones.map((zone) => `<div class="restricted-zone" style="left:${zone.x * 100}%;top:${zone.y * 100}%;width:${zone.width * 100}%;height:${zone.height * 100}%" aria-label="Restricted zone: ${escapeHtml(zone.name || "Restricted area")}"><span>${escapeHtml(zone.name || "Restricted area")}</span></div>`).join("")}
        ${state.zoneDrawingCameraId === camera.id ? `<div class="zone-canvas" data-zone-canvas="${escapeHtml(camera.id)}" tabindex="0" role="application" aria-label="Draw a restricted area: drag or press Enter and use arrow keys to select corners">${state.zoneDraft ? `<div class="zone-draft active" style="left:${state.zoneDraft.x * 100}%;top:${state.zoneDraft.y * 100}%;width:${state.zoneDraft.width * 100}%;height:${state.zoneDraft.height * 100}%"></div>` : `<div class="zone-draft"></div>`}<span data-zone-instructions>${state.zoneDraft?.keyboardPhase === "extent" ? "Use arrows to set the opposite corner · Enter saves · Esc cancels" : state.zoneDraft?.keyboard ? "Use arrows to place the first corner · Enter to set the opposite corner" : "Drag to select · or press Enter and use arrow keys · Esc cancels"}</span></div>` : ""}
        <div class="stage-overlay"><span class="live-badge"><span class="camera-dot ${live ? "live" : status === "error" ? "error" : ""}"></span>${label}</span><span class="quality-badge">${selected ? "FOCUSED · MAIN" : "GRID · SUB"}</span></div>
        ${isAdmin() ? `<div class="tile-tools">
          ${state.layoutEditMode
            ? `<button class="tile-action" data-action="move-camera" data-camera="${escapeHtml(camera.id)}" data-direction="up" aria-label="Move ${escapeHtml(camera.name)} earlier">↑ Move</button>
              <button class="tile-action" data-action="move-camera" data-camera="${escapeHtml(camera.id)}" data-direction="down" aria-label="Move ${escapeHtml(camera.name)} later">↓ Move</button>
              <button class="tile-action" data-action="camera-size" data-camera="${escapeHtml(camera.id)}">Size: ${layoutSize}</button>`
            : `<button class="tile-action" data-action="snapshot" data-camera="${escapeHtml(camera.id)}" aria-label="Capture snapshot">Snapshot</button>
              <button class="tile-action" data-action="toggle-recording" data-camera="${escapeHtml(camera.id)}" aria-label="Start or stop recording">Record</button>
              <button class="tile-action" data-action="draw-zone" data-camera="${escapeHtml(camera.id)}" aria-label="Draw restricted area">Zone</button>
              ${status === "idle" || status === "error" ? `<button class="tile-action" data-action="connect-camera" data-camera="${escapeHtml(camera.id)}">Connect</button>` : ""}
              ${status === "connected" ? `<button class="tile-action" data-action="disconnect-camera" data-camera="${escapeHtml(camera.id)}">Stop</button>` : ""}`}
        </div>` : ""}
      </div>
      <div class="camera-meta"><div style="min-width:0"><div class="camera-title">${String(index + 1).padStart(2, "0")} · ${escapeHtml(camera.name)}</div><div class="camera-location">${escapeHtml(camera.location || "Location not set")}</div></div><div class="camera-health">${escapeHtml(status.toUpperCase())}</div></div>
    </article>`;
  }

  function renderGrid() {
    const visibleCameras = camerasVisibleToCurrentUser();
    const live = [...media.values()].filter((item) => item.status === "connected").length;
    const recording = isAdmin() && state.recording ? `<span class="live-rec"><span class="camera-dot error"></span>REC</span>` : "";
    const controls = isAdmin()
      ? `<button class="btn small" data-action="grid-mode">${state.settings.gridMode === "focus" ? "⊞ Grid" : "⛶ Focus"}</button>
        <button class="btn small ${state.layoutEditMode ? "primary" : ""}" data-action="layout-edit">${state.layoutEditMode ? "Done arranging" : "Arrange tiles"}</button>
        <button class="btn small primary" data-action="add-camera">${SYMBOLS.add} Add camera</button>`
      : `<button class="btn small" data-action="grid-mode">${state.settings.gridMode === "focus" ? "⊞ Grid" : "⛶ Focus"}</button>`;
    return `<div class="section-heading"><div><div class="section-title">${isAdmin() ? "Camera overview" : "Live camera view"}</div><div class="section-description">${isAdmin() ? `Focused stream: main profile · Other active tiles: substream · Decoder budget: ${live}/${state.settings.maxStreams}` : "Select a camera to focus it. Camera layout and system settings are managed by an administrator."}</div></div>
      <div class="toolbar">${recording}${controls}</div></div>
      ${state.zoneDrawingCameraId ? `<div class="notice warning">Area drawing active for ${escapeHtml(cameraById(state.zoneDrawingCameraId)?.name || "camera")}. Wait for the live image, then drag across it or focus the video and press Enter; use the arrow keys to place both corners. <button class="btn small" data-action="cancel-zone">Cancel</button></div>` : ""}
      ${isAdmin() && state.layoutEditMode ? `<div class="notice">Use ↑ / ↓ to change tile order and Size to cycle standard, wide, and large layouts. Changes are shared with all local users.</div>` : ""}
      <div class="camera-grid ${state.settings.gridMode === "focus" ? "focus-view" : ""}">${[...visibleCameras].sort((a,b) => a.sortOrder - b.sortOrder).map(renderTile).join("") || `<div class="empty-state"><strong>${isAdmin() ? "No cameras configured" : "No cameras assigned"}</strong>${isAdmin() ? "Add a camera and enter its go2rtc stream name to get started." : "Ask your administrator to assign one or more cameras to your account."}</div>`}</div>`;
  }

  function renderAnalytics() {
    const categories = ["all", "motion", "license-plate", "known-face", "unknown-face", "access", "system"];
    const visible = state.events.filter((event) => {
      const categoryMatch = state.analyticsFilter === "all" || event.category === state.analyticsFilter;
      const camera = cameraById(event.cameraId);
      const query = state.search.toLocaleLowerCase();
      const text = `${event.summary || ""} ${event.plateText || ""} ${event.label || ""} ${camera?.name || ""}`.toLocaleLowerCase();
      return categoryMatch && (!query || text.includes(query));
    }).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    const counts = categories.slice(1).map((category) => state.events.filter((event) => event.category === category).length);
    return `<div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Events cached</div><div class="stat-value">${state.events.length}</div><div class="stat-foot">In this browser profile</div></div>
      <div class="stat-card"><div class="stat-label">Motion alerts</div><div class="stat-value">${counts[0]}</div><div class="stat-foot">All retained time ranges</div></div>
      <div class="stat-card"><div class="stat-label">Plate detections</div><div class="stat-value">${counts[1]}</div><div class="stat-foot">Sensitive data: restricted</div></div>
      <div class="stat-card"><div class="stat-label">Last feed sync</div><div class="stat-value" style="font-size:17px">${state.analyticsLastSync ? formatDate(state.analyticsLastSync) : "Not synced"}</div><div class="stat-foot">${state.settings.analyticsUrl ? "Configured event feed" : "Local events only"}</div></div>
    </div>
    <div class="section-heading"><div><div class="section-title">Detection events</div><div class="section-description">Events are informational; face detection is not proof of identity.</div></div><div class="toolbar"><button class="btn small" data-action="sync-analytics">↻ Sync feed</button><button class="btn small primary" data-action="add-event">+ Add event</button></div></div>
    <div class="filters">${categories.map((category) => `<button class="filter-chip ${state.analyticsFilter === category ? "active" : ""}" data-action="analytics-filter" data-filter="${category}">${category === "all" ? "All events" : category.replace("-", " ")}</button>`).join("")}<input class="search-input" data-input="analytics-search" placeholder="Search events…" value="${escapeHtml(state.search)}" aria-label="Search events"></div>
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>Category</th><th>Camera</th><th>Details</th><th>Confidence</th><th>Severity</th></tr></thead><tbody>
      ${visible.slice(0, 200).map((event) => {
        const camera = cameraById(event.cameraId);
        return `<tr tabindex="0" data-action="event-detail" data-event="${escapeHtml(event.id)}"><td class="mono">${formatDate(event.occurredAt)}</td><td>${escapeHtml(event.category.replace("-", " "))}</td><td>${escapeHtml(camera?.name || event.cameraName || "Unknown camera")}</td><td>${escapeHtml(event.plateText || event.label || event.summary || "Detection event")}</td><td>${event.confidence == null ? "—" : `${Math.round(event.confidence * 100)}%`}</td><td><span class="severity ${event.severity === "high" ? "high" : event.severity === "low" ? "low" : ""}">${escapeHtml(event.severity || "medium")}</span></td></tr>`;
      }).join("") || `<tr><td colspan="6"><div class="empty-state"><strong>No matching events</strong>Adjust filters or add an event from an integrated analytics source.</div></td></tr>`}
    </tbody></table></div>
    <p class="section-description">Showing up to 200 most recent matching events. IndexedDB cache is local and is not an authoritative audit log.</p>`;
  }

  function renderRecordings() {
    const totalBytes = state.sessions.reduce((sum, session) => sum + (session.bytes || 0), 0);
    const sessions = [...state.sessions].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return `<div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Saved sessions</div><div class="stat-value">${sessions.length}</div><div class="stat-foot">Local browser storage</div></div>
      <div class="stat-card"><div class="stat-label">Recording data</div><div class="stat-value">${formatBytes(totalBytes)}</div><div class="stat-foot">Browser quota is best effort</div></div>
      <div class="stat-card"><div class="stat-label">Active session</div><div class="stat-value" style="font-size:18px">${state.recording ? "Recording" : "None"}</div><div class="stat-foot">${state.recording ? escapeHtml(cameraById(state.recording.cameraId)?.name || "Camera") : "Focus a camera to begin"}</div></div>
      <div class="stat-card"><div class="stat-label">Storage usage</div><div class="stat-value" style="font-size:17px">${state.storage ? `${Math.round(state.storage.percent)}%` : "Unavailable"}</div><div class="stat-foot">${state.storage ? `${formatBytes(state.storage.usage)} of ${formatBytes(state.storage.quota)} estimated` : "Storage estimate not available"}</div></div>
    </div>
    <div class="section-heading"><div><div class="section-title">Recording sessions</div><div class="section-description">One focused camera at a time. Browser recordings are not evidentiary archives.</div></div><div class="toolbar"><button class="btn small" data-action="refresh-storage">Refresh storage</button><button class="btn small danger" data-action="cleanup-recordings">Apply retention cleanup</button></div></div>
    ${state.recording ? `<div class="notice warning">Recording active. Chunks are saved approximately every 60 seconds; an unfinished interval may be lost if the browser closes unexpectedly.</div>` : ""}
    <div class="recording-list">${sessions.map((session) => {
      const camera = cameraById(session.cameraId);
      return `<div class="recording-row"><div><strong>${escapeHtml(camera?.name || session.cameraName || "Removed camera")}</strong><small>${formatDate(session.startedAt)} – ${session.endedAt ? formatDate(session.endedAt) : "In progress"} · ${session.chunkCount || 0} chunks · ${formatBytes(session.bytes || 0)} · ${escapeHtml(session.status)}</small></div>
      <div class="toolbar"><button class="btn small" data-action="play-session" data-session="${escapeHtml(session.id)}">Play / Download</button><button class="btn small danger" data-action="delete-session" data-session="${escapeHtml(session.id)}">Delete</button></div></div>`;
    }).join("") || `<div class="empty-state"><strong>No saved recordings yet</strong>Focus a connected camera, then choose Record from its tile.</div>`}</div>
    <div class="section-heading" style="margin-top:24px"><div><div class="section-title">Saved snapshots</div><div class="section-description">${state.snapshots.length} JPEG snapshot(s) in this browser</div></div></div>
    <div class="recording-list">${[...state.snapshots].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt)).slice(0, 100).map((snapshot) => `<div class="recording-row"><div><strong>${escapeHtml(cameraById(snapshot.cameraId)?.name || "Removed camera")}</strong><small>${formatDate(snapshot.capturedAt, true)} · ${snapshot.width || "?"} × ${snapshot.height || "?"} · ${formatBytes(snapshot.byteLength)}</small></div><div class="toolbar"><button class="btn small" data-action="view-snapshot" data-snapshot="${escapeHtml(snapshot.id)}">View / Download</button><button class="btn small danger" data-action="delete-snapshot" data-snapshot="${escapeHtml(snapshot.id)}">Delete</button></div></div>`).join("") || `<div class="empty-state">No snapshots saved yet.</div>`}</div>`;
  }

  function renderSettings() {
    if (!isAdmin()) return `<div class="empty-state"><strong>Administrator access required</strong>Sign in with an administrator account to manage system settings.</div>`;
    const maxStreams = Number(state.settings.maxStreams);
    return `<div class="settings-grid"><div>
      <section class="panel"><h3>Media gateway</h3><p class="panel-description">Set an explicit go2rtc base URL. Local IP, Tailscale, Cloudflare Tunnel, and reverse-proxy hostnames are supported when DNS, TLS, browser policy, and ICE are correctly configured. The browser does not scan the network.</p>
        <details class="camera-setup-help"><summary>IP camera setup guide (Tapo, Yoosee, V380 and other RTSP cameras)</summary>
          <ol>
            <li>Connect the camera and the go2rtc host to the same trusted LAN. In your router, reserve a stable DHCP address for the camera.</li>
            <li>Check the exact camera model and firmware documentation for RTSP or ONVIF support. In its vendor app, enable local streaming if available and create a dedicated camera account. Cloud/P2P viewing in an app does not necessarily provide RTSP.</li>
            <li>For TP-Link Tapo models that support RTSP, open the camera's settings in the Tapo app, find <strong>Advanced Settings → Camera Account</strong>, and create the local account. The camera's local IP and RTSP paths depend on the model/firmware; <code>/stream1</code> (main) and <code>/stream2</code> (lower-resolution) are common, not universal.</li>
            <li>For Yoosee/V380, look in the model's app/manual for RTSP, ONVIF, or third-party NVR support. If the option or a documented RTSP URL is absent, that model/firmware may be cloud/P2P-only; do not guess a URL or assume it is compatible.</li>
            <li>On the go2rtc host, add a named stream using the camera's documented RTSP URL, then confirm that stream plays in the go2rtc stream page/API. Keep the URL and credentials on the gateway host; encode reserved password characters for URL use.</li>
            <li>Enter the go2rtc server's reachable base URL above and save. Choose <strong>Add camera</strong> in Camera registry and enter the exact go2rtc stream name as the main stream key. Add a separately configured lower-resolution stream name as the substream key, if available.</li>
            <li>Open Live Cameras and connect the tile. Test from every client network (LAN, Tailscale, or tunnel); the browser must reach the gateway over a compatible origin and WebRTC ICE path.</li>
          </ol>
          <p>Never port-forward camera RTSP (usually TCP 554) or an unauthenticated go2rtc service directly to the internet. Use a secured VPN or authenticated HTTPS reverse proxy, firewall camera VLAN access to the gateway, and change default camera passwords. Exact menus and RTSP paths vary by model, region, app, and firmware.</p>
        </details>
        <form data-form="gateway" class="form-grid">
          <div class="field full"><label for="gatewayUrl">go2rtc base URL</label><input id="gatewayUrl" name="gatewayUrl" type="url" placeholder="https://nvr.example.net" value="${escapeHtml(state.settings.gatewayUrl)}"><small>Signaling uses POST /api/webrtc?src=&lt;stream name&gt;. Avoid credentials in URLs. HTTPS is required on HTTPS-hosted dashboards.</small></div>
          <div class="field"><label for="maxStreams">Maximum live streams</label><select id="maxStreams" name="maxStreams">${[1,2,3,4,5,6,7,8,9].map((number) => `<option value="${number}" ${number === maxStreams ? "selected" : ""}>${number} simultaneous decoder${number === 1 ? "" : "s"}</option>`).join("")}</select><small>Default four; qualify your TV hardware before increasing.</small></div>
          <div class="field"><label for="autoLockMinutes">Auto-lock inactivity</label><select id="autoLockMinutes" name="autoLockMinutes">${[0,1,5,10,15,30,60].map((n) => `<option value="${n}" ${n === Number(state.settings.autoLockMinutes) ? "selected" : ""}>${n ? `${n} minutes` : "Disabled"}</option>`).join("")}</select></div>
          <div class="field full"><label for="analyticsUrl">Optional analytics JSON feed URL</label><input id="analyticsUrl" name="analyticsUrl" type="url" placeholder="https://analytics.example.net/events" value="${escapeHtml(state.settings.analyticsUrl)}"><small>Optional same-origin or CORS-enabled endpoint returning an array of normalized events or { events: [...] }. Configure authentication and access controls at the service/proxy.</small></div>
          <div class="field"><label for="retentionDays">Local retention (days)</label><select id="retentionDays" name="retentionDays">${[1,3,7,14,30,90].map((n) => `<option value="${n}" ${n === Number(state.settings.retentionDays) ? "selected" : ""}>${n} days</option>`).join("")}</select><small>Automatically expires recordings and snapshots; analytics cache is capped separately.</small></div>
          <div class="field"><label for="analyticsPollSeconds">Analytics poll interval</label><select id="analyticsPollSeconds" name="analyticsPollSeconds">${[15,30,60,300].map((n) => `<option value="${n}" ${n === Number(state.settings.analyticsPollSeconds) ? "selected" : ""}>${n < 60 ? `${n} seconds` : `${n / 60} minutes`}</option>`).join("")}</select></div>
          <div class="field full"><label class="check-row"><input type="checkbox" name="voiceEnabled" ${state.settings.voiceEnabled ? "checked" : ""}> Enable spoken event alerts</label><label class="check-row"><input type="checkbox" name="muted" ${state.settings.muted ? "checked" : ""}> Mute speech and local alarm audio (visual alerts remain active)</label></div>
          <div class="field full"><div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div></div>
        </form>
      </section>
      <section class="panel"><h3>Camera registry</h3><p class="panel-description">Store go2rtc stream names, not camera credentials. Create separate stream entries in go2rtc for low-resolution grid previews.</p>
        <div class="recording-list">${state.cameras.map((camera) => `<div class="recording-row"><div><strong>${escapeHtml(camera.name)}</strong><small>${escapeHtml(camera.location || "No location")} · ${escapeHtml(camera.streamKey)}${camera.substreamKey ? ` · sub: ${escapeHtml(camera.substreamKey)}` : ""}</small></div><div class="toolbar"><button class="btn small" data-action="edit-camera" data-camera="${escapeHtml(camera.id)}">Edit</button><button class="btn small danger" data-action="delete-camera" data-camera="${escapeHtml(camera.id)}">Remove</button></div></div>`).join("") || `<div class="empty-state">No cameras configured.</div>`}</div>
        <div class="form-actions"><button class="btn primary" data-action="add-camera">+ Add camera</button></div>
      </section>
      <section class="panel"><h3>Restricted areas & alarms</h3><p class="panel-description">Draw zones on a connected camera tile, then enable local frame-change monitoring. This is basic pixel-difference motion detection, not AI/person recognition. It monitors only streams currently open in this dashboard.</p>
        <form data-form="surveillance" class="form-grid">
          <div class="field full"><label class="check-row"><input type="checkbox" name="zonesEnabled" ${state.settings.zonesEnabled ? "checked" : ""}> Enable restricted-zone monitoring</label></div>
          <div class="field"><label for="zoneSensitivity">Motion sensitivity</label><select id="zoneSensitivity" name="zoneSensitivity">${[8,12,18,25,35,50].map((value) => `<option value="${value}" ${value === Number(state.settings.zoneSensitivity) ? "selected" : ""}>${value}% of zone pixels changing</option>`).join("")}</select><small>Lower values detect smaller changes but increase false alarms.</small></div>
          <div class="field"><label class="check-row"><input type="checkbox" name="alarmToneEnabled" ${state.settings.alarmToneEnabled ? "checked" : ""}> Play alarm tone on this dashboard</label><label class="check-row"><input type="checkbox" name="alarmVoiceEnabled" ${state.settings.alarmVoiceEnabled ? "checked" : ""}> Speak zone and camera name</label></div>
          <div class="field full"><label for="alarmWebhookUrl">Optional alarm bridge webhook</label><input id="alarmWebhookUrl" name="alarmWebhookUrl" type="url" value="${escapeHtml(state.settings.alarmWebhookUrl)}" placeholder="https://alarm-bridge.example.net/events"><small>POSTs JSON {event, cameraId, cameraName, zoneName, occurredAt} from this browser. The endpoint must allow CORS. A compatible bridge/camera is required for camera-speaker audio; this dashboard cannot send audio directly into a camera.</small></div>
          <div class="field full"><div class="form-actions"><button class="btn primary" type="submit">Save alarm settings</button><button class="btn" type="button" data-action="test-alarm">Test local alarm</button></div></div>
        </form>
        <div class="field"><label for="zoneName">New restricted-area name</label><input id="zoneName" name="zoneName" maxlength="80" placeholder="e.g. Staff-only doorway"></div>
        <div class="recording-list">${state.cameras.map((camera) => `<div class="recording-row"><div><strong>${escapeHtml(camera.name)}</strong><small>${safeRestrictedZones(camera).length} saved area(s) · ${getCameraConnection(camera.id) === "connected" ? "stream connected" : "will connect in camera view"}</small></div><button class="btn small" data-action="draw-zone" data-camera="${escapeHtml(camera.id)}">Draw area</button></div>${safeRestrictedZones(camera).map((zone) => `<div class="recording-row zone-row"><div><strong>${escapeHtml(zone.name || "Restricted area")}</strong><small>${zone.enabled === false ? "Disabled" : "Monitoring when alarm is enabled"}</small></div><button class="btn small danger" data-action="delete-zone" data-camera="${escapeHtml(camera.id)}" data-zone="${escapeHtml(zone.id)}">Remove area</button></div>`).join("")}`).join("") || `<div class="empty-state">Add a camera before creating restricted areas.</div>`}</div>
        ${state.zoneDrawingCameraId ? `<div class="notice warning">Area drawing is active for ${escapeHtml(cameraById(state.zoneDrawingCameraId)?.name || "camera")}. Drag over the video, or focus it and press Enter to use D-pad arrows. Press Escape to cancel.</div>` : ""}
      </section>
      <section class="panel"><h3>Viewer access & subscriptions</h3><p class="panel-description">Choose which configured cameras each viewer may watch, along with local subscription and daily viewing limits. Access settings are stored in this browser only; see the security notes below for multi-device limitations.</p>
        <form data-form="user" class="form-grid">
          <div class="field"><label for="newUsername">Username</label><input id="newUsername" name="username" minlength="3" maxlength="32" autocomplete="off" required></div>
          <div class="field"><label for="newUserPin">Four-digit PIN</label><input id="newUserPin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" required></div>
          <div class="field"><label for="newUserDays">Subscription days (0 = no expiry)</label><input id="newUserDays" name="subscriptionDays" type="number" min="0" max="3650" value="30" required></div>
          <div class="field"><label for="newUserHours">Daily viewing hours (0 = unlimited)</label><input id="newUserHours" name="dailyHours" type="number" min="0" max="24" step="0.25" value="8" required></div>
          <fieldset class="field full camera-assignment-list"><legend>Cameras this viewer can access</legend>${renderCameraAssignmentOptions("cameraIds")}</fieldset>
          <div class="field full"><label for="newUserRenewal">Renewal/payment URL (optional)</label><input id="newUserRenewal" name="renewalUrl" type="url" placeholder="https://payments.example.net/renew"></div>
          <div class="field full"><div class="form-actions"><button class="btn primary" type="submit">Create viewer account</button></div></div>
        </form>
        <div class="recording-list">${state.accounts.map((account) => {
          if (account.role !== "user") return `<div class="recording-row"><div><strong>${escapeHtml(account.username)}</strong><small>Administrator account</small></div></div>`;
          const dailyHours = Number(account.dailyLimitMinutes || 0) / 60;
          const accountCameraIds = Array.isArray(account.cameraIds)
            ? account.cameraIds
            : state.cameras.filter((camera) => camera.enabled !== false).map((camera) => camera.id);
          const assignedCameras = camerasForAccount(account);
          return `<form data-form="access" class="account-access"><input type="hidden" name="username" value="${escapeHtml(account.username)}"><div class="recording-row"><div><strong>${escapeHtml(account.username)}</strong><small>${account.subscriptionExpiresAt ? `Expires ${formatDate(account.subscriptionExpiresAt, true)}` : "No subscription expiry"} · ${dailyHours ? `${dailyHours} h/day` : "Unlimited daily use"} · ${account.enabled === false ? "Viewing paused" : "Enabled"}</small></div><div class="toolbar"><button class="btn small" type="button" data-action="copy-user-link" data-username="${escapeHtml(account.username)}">Copy link</button><button class="btn small danger" type="button" data-action="delete-user" data-username="${escapeHtml(account.username)}">Remove</button></div></div>
            <div class="form-grid"><div class="field"><label>Subscription ends (local time; blank = no expiry)</label><input name="subscriptionEndsAt" type="datetime-local" value="${escapeHtml(toLocalDateTimeInput(account.subscriptionExpiresAt))}"></div><div class="field"><label>Daily hours (0 = unlimited)</label><input name="dailyHours" type="number" min="0" max="24" step="0.25" value="${dailyHours}"></div><fieldset class="field full camera-assignment-list"><legend>Camera access · ${assignedCameras.length} assigned</legend>${renderCameraAssignmentOptions("cameraIds", accountCameraIds)}</fieldset><div class="field full"><label>Renewal/payment URL</label><input name="renewalUrl" type="url" value="${escapeHtml(account.renewalUrl || "")}" placeholder="https://payments.example.net/renew"></div><div class="field full"><label>Viewer service message</label><input name="accessMessage" maxlength="240" value="${escapeHtml(account.accessMessage || "Service Maintenance — viewing has been paused by the administrator.")}"></div><div class="field full"><label class="check-row"><input type="checkbox" name="enabled" ${account.enabled !== false ? "checked" : ""}> Allow this viewer to access cameras</label><div class="form-actions"><button class="btn small primary" type="submit">Save access</button></div></div></div></form>`;
        }).join("") || `<div class="empty-state">No viewer accounts created.</div>`}</div>
      </section>
      <section class="panel"><h3>Service-wide maintenance</h3><p class="panel-description">Temporarily block all viewer accounts with a clear message. Administrators retain access. This local switch does not disconnect existing sessions on other devices.</p><form data-form="maintenance" class="form-grid"><div class="field full"><label class="check-row"><input type="checkbox" name="maintenanceEnabled" ${state.settings.maintenanceEnabled ? "checked" : ""}> Pause viewing for all local viewer accounts</label></div><div class="field full"><label for="maintenanceMessage">Message shown to viewers</label><textarea id="maintenanceMessage" name="maintenanceMessage" maxlength="240" rows="3" required>${escapeHtml(state.settings.maintenanceMessage)}</textarea></div><div class="field full"><button class="btn primary" type="submit">Save service status</button></div></form></section>
      </section>
      <section class="panel"><h3>Recent sign-in log</h3><p class="panel-description">Best-effort local log of successful and failed sign-ins. It is not tamper-proof or server-audited.</p>
        <div class="recording-list">${state.accessLog.slice(0, 20).map((entry) => `<div class="recording-row"><div><strong>${escapeHtml(entry.username)} · ${entry.result === "success" ? "Signed in" : "Failed sign-in"}</strong><small>${escapeHtml(entry.role)} · ${formatDate(entry.timestamp, true)}</small></div><span class="severity ${entry.result === "failed" ? "high" : "low"}">${escapeHtml(entry.result)}</span></div>`).join("") || `<div class="empty-state">No sign-in attempts recorded in this browser.</div>`}</div>
      </section>
      </div>
      <div><section class="panel"><h3>Storage health</h3><p class="panel-description">Browser quota is an estimate and local data can be evicted. Use an NVR for durable or evidentiary recording.</p>
        <div class="stat-label">Estimated browser storage</div><div class="progress"><span style="width:${state.storage ? Math.min(100, state.storage.percent) : 0}%"></span></div>
        <div class="section-description">${state.storage ? `${formatBytes(state.storage.usage)} used of ${formatBytes(state.storage.quota)}` : "Storage estimate unavailable"}</div>
        <div class="form-actions"><button class="btn small" data-action="refresh-storage">Refresh estimate</button><button class="btn small danger" data-action="cleanup-recordings">Clean old recordings</button></div>
      </section>
      <section class="panel"><h3>Local account lock</h3><p class="panel-description">Username and PIN checks run only in this browser. They do not authorize gateway access and can be bypassed by clearing or modifying browser storage. Use server-side authentication for security boundaries.</p>
        <button class="btn" data-action="lock">Lock now</button> <button class="btn danger" data-action="reset-pin">Reset all local accounts</button>
      </section>
      <section class="panel"><h3>Keyboard & remote shortcuts</h3><p class="panel-description"><span class="kbd">1–9</span> camera · <span class="kbd">0</span> reset grid · <span class="kbd">G</span> grid · <span class="kbd">A</span> analytics · <span class="kbd">R</span> recordings · <span class="kbd">M</span> mute · <span class="kbd">S</span> snapshot · <span class="kbd">P</span> PiP · <span class="kbd">L</span> lock</p>
        <button class="btn small" data-action="export-data">Export event metadata</button> <button class="btn small" data-action="reset-app">Reset camera setup</button>
      </section></div></div>`;
  }

  function renderView() {
    if (!isAdmin() && state.auth === "unlocked") {
      const account = currentViewerAccount();
      const access = viewerAccessStatus(account);
      if (!access.allowed) return renderViewerAccessGate(account, access);
      const allowedCameras = camerasForAccount(account);
      if (!allowedCameras.length) {
        return renderViewerAccessGate(account, {
          reason: "cameras",
          message: "No cameras have been assigned to your account. Please contact the administrator.",
        });
      }
      const limit = Number(account?.dailyLimitMinutes || 0);
      const today = localDayKey();
      const usedSeconds = account?.usageDay === today ? Math.max(0, Number(account.usedSeconds) || 0) : 0;
      const remaining = limit ? Math.max(0, limit * 60 - usedSeconds) : 0;
      const expiration = account?.subscriptionExpiresAt ? new Date(account.subscriptionExpiresAt).getTime() : 0;
      return `<div class="viewer-plan"><strong>Viewer access</strong><span>${allowedCameras.length} camera${allowedCameras.length === 1 ? "" : "s"} assigned</span><span>${expiration ? `Subscription: ${formatCountdown(expiration - Date.now())} remaining` : "Subscription: no expiry set"}</span><span>${limit ? `Today's viewing time: ${formatUsageTime(remaining)} remaining of ${formatUsageTime(limit * 60)}` : "Daily viewing limit: unlimited"}</span></div>${renderGrid()}`;
    }
    if (state.view === "analytics") return renderAnalytics();
    if (state.view === "recordings") return renderRecordings();
    if (state.view === "settings") return renderSettings();
    return renderGrid();
  }

  function renderViewerAccessGate(account, access) {
    const renewal = account?.renewalUrl || "";
    const title = access.reason === "expired" ? "Subscription expired"
      : access.reason === "limit" ? "Daily viewing limit reached"
        : access.reason === "cameras" ? "No cameras assigned"
          : "Viewing unavailable";
    return `<section class="access-gate"><div class="access-gate-icon">${access.reason === "expired" ? "◷" : "!"}</div><h1>${title}</h1><p>${escapeHtml(access.message)}</p>${access.reason === "expired" && renewal ? `<a class="btn primary" href="${escapeHtml(renewal)}" target="_blank" rel="noopener noreferrer">Open renewal / payment link</a>` : ""}<p class="section-description">${access.reason === "limit" ? "Daily allowance resets at local midnight." : "Contact your administrator if this looks incorrect."}</p></section>`;
  }

  function renderShell() {
    const [heading, subtitle] = pageInfo();
    const liveCount = [...media.values()].filter((item) => item.status === "connected").length;
    const cameraStatus = liveCount ? `${liveCount} LIVE` : "GATEWAY IDLE";
    const roleBadge = state.auth === "unlocked" ? `${state.currentUser?.username || ""} · ${isAdmin() ? "ADMIN" : "USER"}` : "";
    const navigation = isAdmin()
      ? `${navButton("grid", "Live cameras", SYMBOLS.grid)}${navButton("analytics", "Event analytics", SYMBOLS.analytics, String(state.events.length))}${navButton("recordings", "Recordings", SYMBOLS.recordings, String(state.sessions.length))}`
      : navButton("grid", "Live cameras", SYMBOLS.grid);
    root.innerHTML = `<div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SENTINEL</div><div class="brand-sub">Security Command</div></div></div>
        <div><div class="nav-label">Workspace</div><nav class="nav-stack">${navigation}</nav></div>
        ${isAdmin() ? `<div><div class="nav-label">Camera registry <button class="icon-btn" style="float:right;margin-top:-8px;height:25px" data-action="add-camera" aria-label="Add camera">+</button></div><div class="camera-list">${renderCameraNavigation()}</div></div>` : `<div class="role-notice">${state.auth === "unlocked" ? "Viewer account" : "System locked"}<br><small>${state.auth === "unlocked" ? "Live camera access only" : "Sign in to continue"}</small></div>`}
        <div class="side-bottom"><div class="gateway-card"><div class="gateway-title"><span class="camera-dot ${liveCount ? "live" : ""}"></span> ${cameraStatus}</div><div class="gateway-url">${escapeHtml(state.settings.gatewayUrl || "Gateway not configured")}</div></div>${isAdmin() ? navButton("settings", "Settings", SYMBOLS.settings) : ""}<button class="nav-item" data-action="lock"><span class="nav-icon">${SYMBOLS.lock}</span><span>Lock system</span><span class="nav-count">L</span></button><button class="nav-item" data-action="logout"><span class="nav-icon">↪</span><span>Sign out</span></button></div>
      </aside>
      <main class="main-area"><header class="topbar"><div><div class="page-heading">${heading}</div><div class="page-subtitle">${subtitle}</div></div><div class="top-actions"><span class="role-badge">${escapeHtml(roleBadge)}</span><span class="status-pill"><span class="live-indicator"></span>${escapeHtml(cameraStatus)}</span><button class="icon-btn" data-action="pip" aria-label="Picture in picture" title="Picture-in-picture (P)">▣</button><button class="icon-btn" data-action="mute" aria-label="${state.settings.muted ? "Unmute speech and local alarms" : "Mute speech and local alarms"}" title="Mute (M)">${state.settings.muted ? "◌" : "◖"}</button><button class="icon-btn" data-action="lock" aria-label="Lock system" title="Lock (L)">⌑</button><button class="icon-btn" data-action="logout" aria-label="Sign out">↪</button></div></header><div class="content">${renderView()}</div></main>
      <nav class="mobile-menu" aria-label="Main navigation">${isAdmin() ? `${navButton("grid", "Cameras", SYMBOLS.grid)}${navButton("analytics", "Events", SYMBOLS.analytics)}${navButton("recordings", "Clips", SYMBOLS.recordings)}${navButton("settings", "Settings", SYMBOLS.settings)}` : navButton("grid", "Cameras", SYMBOLS.grid)}</nav>
    </div><div id="modal-root"></div>`;
    if (state.modal) renderModal();
    if (state.auth !== "unlocked") renderAuth();
    else document.getElementById("auth-root")?.remove();
  }

  function renderModal() {
    const container = document.getElementById("modal-root");
    if (!container || !state.modal) return;
    const modal = state.modal;
    if (modal.snapshotUrl) URL.revokeObjectURL(modal.snapshotUrl);
    modal.snapshotUrl = "";
    if (modal.playerUrl) URL.revokeObjectURL(modal.playerUrl);
    modal.playerUrl = "";
    let title = "";
    let body = "";
    let footer = "";
    let wide = false;
    if (modal.type === "camera") {
      const camera = modal.camera || {};
      title = camera.id ? "Edit camera" : "Add camera";
      body = `<form data-form="camera" id="camera-form" class="form-grid">
        <input type="hidden" name="id" value="${escapeHtml(camera.id || "")}">
        <div class="field"><label for="cameraName">Camera name</label><input id="cameraName" name="name" maxlength="80" required value="${escapeHtml(camera.name || "")}" placeholder="North gate"></div>
        <div class="field"><label for="cameraLocation">Location</label><input id="cameraLocation" name="location" maxlength="100" value="${escapeHtml(camera.location || "")}" placeholder="Building A"></div>
        <div class="field full"><label for="cameraStream">Main stream key</label><input id="cameraStream" name="streamKey" maxlength="160" required value="${escapeHtml(camera.streamKey || "")}" placeholder="north_gate"><small>Must match an existing go2rtc stream name. No camera URL credentials.</small></div>
        <div class="field full"><label for="cameraSubstream">Low-resolution substream key (recommended)</label><input id="cameraSubstream" name="substreamKey" maxlength="160" value="${escapeHtml(camera.substreamKey || "")}" placeholder="north_gate_sub"><small>Grid streams should be low resolution/bitrate to reduce TV decoder load.</small></div>
      </form>`;
      footer = `<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" form="camera-form" type="submit">Save camera</button>`;
    } else if (modal.type === "event") {
      title = "Add analytics event";
      body = `<form data-form="event" id="event-form" class="form-grid">
        <div class="field"><label for="eventCategory">Category</label><select id="eventCategory" name="category"><option value="motion">Motion</option><option value="license-plate">License plate</option><option value="known-face">Known face</option><option value="unknown-face">Unknown face</option><option value="access">Access history</option><option value="system">System</option></select></div>
        <div class="field"><label for="eventCamera">Camera</label><select id="eventCamera" name="cameraId">${state.cameras.map((camera) => `<option value="${escapeHtml(camera.id)}">${escapeHtml(camera.name)}</option>`).join("")}</select></div>
        <div class="field full"><label for="eventSummary">Description</label><input id="eventSummary" name="summary" maxlength="240" required placeholder="Motion detected in loading zone"></div>
        <div class="field"><label for="eventSeverity">Severity</label><select id="eventSeverity" name="severity"><option>low</option><option selected>medium</option><option>high</option></select></div>
        <div class="field"><label for="eventConfidence">Confidence % (optional)</label><input id="eventConfidence" name="confidence" type="number" min="0" max="100" placeholder="92"></div>
        <div class="field full"><label for="eventPlate">Plate or identity label (optional, sensitive)</label><input id="eventPlate" name="label" maxlength="80" placeholder="Leave blank unless permitted"></div>
      </form>`;
      footer = `<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" form="event-form" type="submit">Save event</button>`;
    } else if (modal.type === "event-detail") {
      const event = state.events.find((item) => item.id === modal.eventId);
      title = event ? "Event details" : "Event unavailable";
      const snapshot = event?.snapshotId ? state.snapshots.find((item) => item.id === event.snapshotId) : null;
      const snapshotUrl = snapshot ? URL.createObjectURL(snapshot.blob) : "";
      modal.snapshotUrl = snapshotUrl;
      body = event ? `<div class="event-detail"><strong>${escapeHtml(event.category.replace("-", " "))}</strong><br>Camera: ${escapeHtml(cameraById(event.cameraId)?.name || event.cameraName || "Unknown")}<br>Time: ${formatDate(event.occurredAt, true)}<br>Severity: ${escapeHtml(event.severity || "medium")}<br>Confidence: ${event.confidence == null ? "Not provided" : `${Math.round(event.confidence * 100)}%`}<br>Description: ${escapeHtml(event.summary || "Detection event")}<br>${event.plateText || event.label ? `Sensitive label: ${escapeHtml(event.plateText || event.label)}<br>` : ""}${event.source ? `Source: ${escapeHtml(event.source)}` : ""}</div>${snapshotUrl ? `<img class="event-image" src="${escapeHtml(snapshotUrl)}" alt="Related camera snapshot">` : ""}` : `<p class="muted">This event may have been removed.</p>`;
      footer = `<button class="btn" data-action="close-modal">Close</button>`;
    } else if (modal.type === "player") {
      wide = true;
      const session = state.sessions.find((item) => item.id === modal.sessionId);
      title = "Recording playback";
      body = `<p class="panel-description">${escapeHtml(cameraById(session?.cameraId)?.name || "Camera")} · ${formatDate(session?.startedAt)}</p><video id="recording-player" controls playsinline style="width:100%;max-height:60vh;background:#05070a;border-radius:8px"></video>`;
      footer = `<a id="download-recording" class="btn" download="sentinel-recording.webm">Download clip</a><button class="btn" data-action="close-modal">Close</button>`;
    } else if (modal.type === "confirm") {
      title = modal.title;
      body = `<p class="event-detail">${escapeHtml(modal.message)}</p>`;
      footer = `<button class="btn" data-action="close-modal">Cancel</button><button class="btn ${modal.danger ? "danger" : "primary"}" data-action="confirm-modal">Confirm</button>`;
    } else if (modal.type === "snapshot") {
      title = "Camera snapshot";
      body = `<p class="panel-description">${escapeHtml(modal.message || "")}</p>${modal.url ? `<img class="event-image" src="${escapeHtml(modal.url)}" alt="Captured camera snapshot">` : ""}`;
      footer = `${modal.url ? `<a class="btn" href="${escapeHtml(modal.url)}" download="${escapeHtml(modal.filename || "snapshot.jpg")}">Download JPEG</a>` : ""}<button class="btn" data-action="close-modal">Close</button>`;
    }
    container.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${escapeHtml(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close dialog">×</button></header><div class="modal-body">${body}</div><footer class="modal-footer">${footer}</footer></section></div>`;
    const first = container.querySelector("input:not([type=hidden]), select, button, a");
    first?.focus();
    if (modal.type === "player") loadSessionPlayback(modal.sessionId);
  }

  function renderAuth() {
    const authRoot = document.getElementById("auth-root") || document.createElement("div");
    authRoot.id = "auth-root";
    if (!authRoot.isConnected) document.body.append(authRoot);
    const configured = localStorage.getItem(AUTH_KEY);
    const isSetup = !configured || state.authStep === "setup" || state.authStep === "confirm";
    const title = isSetup ? state.authStep === "confirm" ? "Confirm administrator PIN" : "Set up administrator account" : "Sign in";
    const message = isSetup
      ? state.authStep === "confirm" ? "Enter the same four digits again to confirm your administrator PIN." : "Create the first administrator username and four-digit PIN."
      : "Enter your username and PIN to open the command center.";
    authRoot.innerHTML = `<div class="auth-screen"><section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title"><div class="brand-mark">S</div><h1 id="auth-title">SENTINEL</h1><p>${title}. ${message}</p>
      ${state.authStep !== "confirm" ? `<label class="auth-username-label" for="auth-username">${isSetup ? "Administrator username" : "Username"}</label><input id="auth-username" class="auth-username" type="text" minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escapeHtml(isSetup ? state.setupUsername : state.authUsername)}" placeholder="admin" aria-label="${isSetup ? "Create administrator username" : "Username"}">` : `<div class="auth-username-display">Administrator: <strong>${escapeHtml(state.setupUsername)}</strong></div>`}
      <div class="pin-display" aria-label="${state.pinInput.length} of 4 PIN digits entered">${[0,1,2,3].map((index) => `<span class="pin-dot ${index < state.pinInput.length ? "filled" : ""}"></span>`).join("")}</div>
      <div class="pin-keypad" aria-label="PIN keypad">${["1","2","3","4","5","6","7","8","9","⌫","0","C"].map((key) => `<button class="pin-key" data-action="pin-key" data-key="${key}" aria-label="${key === "⌫" ? "Delete last digit" : key === "C" ? "Clear PIN" : `Digit ${key}`}">${key}</button>`).join("")}</div>
      <div class="pin-error" role="alert">${escapeHtml(authError)}</div>
      <div class="auth-note">Local browser accounts are not server authentication. Browser storage can be inspected, changed, or cleared. Protect camera and gateway services separately.</div>
      <input id="pin-keyboard" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" aria-label="Enter four-digit PIN" style="position:absolute;opacity:.01;width:1px;height:1px;left:-100px" maxlength="4">
    </section></div>`;
    if (state.authStep !== "confirm" && state.pinInput.length === 0) {
      document.getElementById("auth-username")?.focus({ preventScroll: true });
    } else {
      document.getElementById("pin-keyboard")?.focus({ preventScroll: true });
    }
  }

  function render() {
    renderShell();
    reattachMediaElements();
    updateCameraIndicators();
    syncGridStreams();
  }

  function reattachMediaElements() {
    for (const [cameraId, session] of media) {
      const nextVideo = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
      if (nextVideo && nextVideo !== session.video) {
        nextVideo.srcObject = session.video?.srcObject || null;
        nextVideo.muted = true;
        session.video = nextVideo;
        if (nextVideo.srcObject) nextVideo.play().catch(() => {});
      }
    }
  }

  function updateCameraIndicators() {
    for (const [cameraId, session] of media) {
      const video = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
      const placeholder = document.querySelector(`[data-placeholder="${CSS.escape(cameraId)}"]`);
      const live = session.status === "connected" && video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      if (video) video.classList.toggle("visible", live);
      if (placeholder) {
        placeholder.style.display = live ? "none" : "grid";
        const message = placeholder.querySelector(".placeholder-state");
        if (message) message.textContent = session.message || (session.status === "connected" ? "Waiting for first frame" : session.status.toUpperCase());
      }
    }
  }

  function currentGateway() {
    const raw = String(state.settings.gatewayUrl || "").trim();
    if (!raw) throw new Error("Configure the go2rtc gateway URL in Settings first.");
    const url = new URL(raw, location.href);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Gateway URL must use HTTP or HTTPS.");
    if (location.protocol === "https:" && url.protocol !== "https:") throw new Error("An HTTPS dashboard cannot connect to an insecure HTTP gateway.");
    if (url.username || url.password) throw new Error("Remove credentials from the gateway URL and configure authentication at the proxy.");
    if (url.search || url.hash) throw new Error("Gateway URL must not contain a query or fragment.");
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  }

  function signalUrl(camera) {
    const base = currentGateway();
    const streamKey = camera.id === state.selectedCameraId ? camera.streamKey : (camera.substreamKey || camera.streamKey);
    const gateway = new URL(base);
    gateway.pathname = `${gateway.pathname.replace(/\/+$/, "")}/api/webrtc`;
    const url = gateway;
    url.searchParams.set("src", streamKey);
    return { url: url.toString(), streamKey };
  }

  function waitIceGathering(peer, timeoutMs = 1800) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      timer = window.setTimeout(finish, timeoutMs);
      peer.addEventListener("icegatheringstatechange", check);
    });
  }

  function streamStatus(cameraId, status, message = "") {
    const current = media.get(cameraId);
    if (!current) return;
    current.status = status;
    current.message = message;
    updateCameraIndicators();
    updateCameraNavigationStatus(cameraId);
  }

  function updateCameraNavigationStatus(cameraId) {
    const camera = cameraById(cameraId);
    if (!camera) return;
    const button = [...document.querySelectorAll(".camera-nav")].find((item) => item.dataset.camera === cameraId);
    if (!button) return;
    const dot = button.querySelector(".camera-dot");
    if (!dot) return;
    dot.classList.toggle("live", getCameraConnection(cameraId) === "connected");
    dot.classList.toggle("error", getCameraConnection(cameraId) === "error");
  }

  async function connectCamera(cameraId, manual = false) {
    const camera = cameraById(cameraId);
    if (!camera || !camera.enabled) return;
    if (!canViewCamera(cameraId)) {
      if (manual) notify("This camera has not been assigned to your viewer account.", "warning");
      return;
    }
    const existing = media.get(cameraId);
    if (existing?.status === "connecting" || existing?.status === "connected") return;
    if (existing) closeCamera(cameraId);
    const connected = [...media.values()].filter((item) => item.status === "connected" || item.status === "connecting").length;
    if (connected >= Number(state.settings.maxStreams)) {
      if (!manual) return;
      const victim = [...media.entries()].find(([key, item]) => key !== state.selectedCameraId && item.status === "connected");
      if (victim) closeCamera(victim[0]);
      else {
        notify(`Decoder budget reached (${state.settings.maxStreams}). Stop another stream first.`, "warning");
        return;
      }
    }
    let peer;
    let video;
    let session;
    try {
      const target = signalUrl(camera);
      peer = new RTCPeerConnection({ iceServers: [] });
      video = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
      if (!video) throw new Error("Camera video surface is not available.");
      session = { peer, video, status: "connecting", message: "Negotiating WebRTC", retry: 0, timer: null, firstFrameTimer: null, streamKey: target.streamKey };
      media.set(cameraId, session);
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.ontrack = (event) => {
        const activeVideo = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
        if (!activeVideo || !media.has(cameraId)) return;
        activeVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
        activeVideo.muted = true;
        activeVideo.play().then(() => {
          const current = media.get(cameraId);
          if (!current) return;
          clearTimeout(current.firstFrameTimer);
          current.firstFrameTimer = window.setTimeout(() => {
            if (activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) streamStatus(cameraId, "connected", "");
          }, 350);
        }).catch((error) => {
          const current = media.get(cameraId);
          if (current) {
            current.status = "connected";
            current.message = "Autoplay blocked — press Play";
            updateCameraIndicators();
          }
          console.warn("Browser blocked camera autoplay:", error);
        });
      };
      peer.onconnectionstatechange = () => {
        const current = media.get(cameraId);
        if (!current) return;
        if (peer.connectionState === "connected") {
          current.status = "connected";
          current.message = "Waiting for video";
          clearTimeout(current.firstFrameTimer);
          current.firstFrameTimer = window.setTimeout(() => {
            if (current.status === "connected" && current.video?.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              current.message = "No video frames received";
              updateCameraIndicators();
            }
          }, 8500);
          updateCameraNavigationStatus(cameraId);
        } else if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          if (peer.connectionState === "disconnected") {
            current.timer = window.setTimeout(() => {
              if (media.get(cameraId) === current) reconnectCamera(cameraId);
            }, 3500 + Math.random() * 1500);
          } else reconnectCamera(cameraId);
        } else if (peer.connectionState === "closed") {
          current.status = "idle";
          updateCameraNavigationStatus(cameraId);
        }
      };
      peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === "failed") reconnectCamera(cameraId);
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitIceGathering(peer);
      const response = await fetchWithTimeout(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: peer.localDescription.sdp,
      }, 12000);
      if (media.get(cameraId) !== session || state.auth !== "unlocked" || state.view !== "grid") return;
      if (!response.ok) throw new Error(`go2rtc signaling returned HTTP ${response.status}.`);
      const answer = await response.text();
      let sdp = answer;
      if (answer.trim().startsWith("{")) {
        const body = JSON.parse(answer);
        sdp = body.sdp || body.answer || "";
      }
      if (!sdp.trim().startsWith("v=")) throw new Error("Gateway returned an invalid WebRTC answer.");
      await peer.setRemoteDescription({ type: "answer", sdp });
      session.status = "connecting";
      session.message = "Waiting for first frame";
      session.firstFrameTimer = window.setTimeout(() => {
        if (session.status !== "connected") reconnectCamera(cameraId);
      }, 12000);
      updateCameraIndicators();
      updateCameraNavigationStatus(cameraId);
    } catch (error) {
      if (session && media.get(cameraId) !== session) return;
      if (peer) peer.close();
      const current = media.get(cameraId) || { retry: 0 };
      current.peer = null;
      current.status = "error";
      current.message = error.name === "TimeoutError" ? "Gateway timed out" : error.message || "Stream unavailable";
      media.set(cameraId, current);
      updateCameraIndicators();
      updateCameraNavigationStatus(cameraId);
      if (manual) notify(`${camera.name}: ${current.message}`, "error");
      console.error(`Camera connection failed (${camera.name}):`, error);
    }
  }

  function closeCamera(cameraId) {
    const session = media.get(cameraId);
    zoneSamples.delete(cameraId);
    unavailableZoneCameras.delete(cameraId);
    for (const key of zoneHitCounts.keys()) if (key.startsWith(`${cameraId}:`)) zoneHitCounts.delete(key);
    if (!session) return;
    clearTimeout(session.timer);
    clearTimeout(session.firstFrameTimer);
    if (session.peer) {
      session.peer.ontrack = null;
      session.peer.onconnectionstatechange = null;
      session.peer.oniceconnectionstatechange = null;
      session.peer.close();
    }
    const video = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`) || session.video;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.classList.remove("visible");
    }
    media.delete(cameraId);
    updateCameraIndicators();
    updateCameraNavigationStatus(cameraId);
  }

  function reconnectCamera(cameraId) {
    const session = media.get(cameraId);
    if (!session) return;
    if (state.recording?.cameraId === cameraId) stopRecording("stream-interrupted");
    const retries = (session.retry || 0) + 1;
    closeCamera(cameraId);
    const previous = { retry: retries };
    media.set(cameraId, previous);
    if (retries > 4 || state.auth !== "unlocked") {
      previous.status = "error";
      previous.message = retries > 4 ? "Reconnect limit reached" : "System locked";
      updateCameraIndicators();
      updateCameraNavigationStatus(cameraId);
      return;
    }
    const delay = Math.min(15000, 900 * (2 ** (retries - 1))) + Math.random() * 450;
    previous.status = "connecting";
    previous.message = `Retrying in ${Math.ceil(delay / 1000)}s`;
    updateCameraIndicators();
    previous.timer = window.setTimeout(() => {
      if (media.get(cameraId) === previous) {
        media.delete(cameraId);
        connectCamera(cameraId);
        const replacement = media.get(cameraId);
        if (replacement) replacement.retry = retries;
      }
    }, delay);
  }

  function syncGridStreams() {
    if (state.view !== "grid" || state.auth !== "unlocked" || document.visibilityState !== "visible"
      || (!isAdmin() && !viewerAccessStatus().allowed)) {
      for (const cameraId of [...media.keys()]) closeCamera(cameraId);
      syncZoneMonitor();
      return;
    }
    if (!state.settings.gatewayUrl) {
      for (const cameraId of [...media.keys()]) closeCamera(cameraId);
      syncZoneMonitor();
      return;
    }
    const eligible = camerasVisibleToCurrentUser().filter((camera) => camera.enabled !== false);
    const limit = Number(state.settings.maxStreams);
    const visibleIds = new Set([...document.querySelectorAll(".camera-card")].filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }).map((card) => card.dataset.camera));
    const eligibleNow = eligible.filter((camera) => visibleIds.has(camera.id) || state.recording?.cameraId === camera.id);
    const prioritized = [
      ...eligibleNow.filter((camera) => camera.id === state.selectedCameraId),
      ...eligibleNow.filter((camera) => camera.id !== state.selectedCameraId),
    ].slice(0, limit);
    for (const cameraId of [...media.keys()]) {
      if (!prioritized.some((camera) => camera.id === cameraId)) closeCamera(cameraId);
    }
    prioritized.forEach((camera) => {
      const session = media.get(camera.id);
      const expected = camera.id === state.selectedCameraId ? camera.streamKey : (camera.substreamKey || camera.streamKey);
      if (session && session.streamKey && session.streamKey !== expected) closeCamera(camera.id);
      if (!media.has(camera.id)) connectCamera(camera.id);
    });
    syncZoneMonitor();
  }

  function syncZoneMonitor() {
    const canMonitor = state.settings.zonesEnabled && state.auth === "unlocked"
      && state.view === "grid" && document.visibilityState === "visible"
      && (isAdmin() || viewerAccessStatus().allowed)
      && state.cameras.some((camera) => safeRestrictedZones(camera).some((zone) => zone.enabled !== false));
    if (!canMonitor) {
      clearInterval(zoneMonitorTimer);
      zoneMonitorTimer = undefined;
      zoneSamples.clear();
      zoneHitCounts.clear();
      return;
    }
    if (!zoneMonitorTimer) zoneMonitorTimer = window.setInterval(sampleRestrictedZones, 1000);
  }

  function sampleRestrictedZones() {
    if (!zoneCanvas) {
      zoneCanvas = document.createElement("canvas");
      zoneCanvas.width = 80;
      zoneCanvas.height = 45;
      zoneCanvasContext = zoneCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!zoneCanvasContext) {
      if (!zoneCanvasWarning) {
        zoneCanvasWarning = true;
        clearInterval(zoneMonitorTimer);
        zoneMonitorTimer = undefined;
        console.error("Restricted-zone monitoring requires a browser with Canvas 2D support.");
        notify("Restricted-zone monitoring is unavailable because Canvas 2D is unsupported.", "error");
      }
      return;
    }
    for (const camera of state.cameras) {
      const zones = safeRestrictedZones(camera).filter((zone) => zone.enabled !== false);
      const session = media.get(camera.id);
      const video = session?.video;
      if (!zones.length || unavailableZoneCameras.has(camera.id) || session?.status !== "connected"
        || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue;
      try {
        const stage = video.closest(".video-stage");
        const displayAspect = stage?.clientWidth && stage.clientHeight ? stage.clientWidth / stage.clientHeight : zoneCanvas.width / zoneCanvas.height;
        const sourceAspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : zoneCanvas.width / zoneCanvas.height;
        let visibleWidth = 1;
        let visibleHeight = 1;
        let visibleLeft = 0;
        let visibleTop = 0;
        if (sourceAspect > displayAspect) {
          visibleWidth = displayAspect / sourceAspect;
          visibleLeft = (1 - visibleWidth) / 2;
        } else if (sourceAspect < displayAspect) {
          visibleHeight = sourceAspect / displayAspect;
          visibleTop = (1 - visibleHeight) / 2;
        }
        zoneCanvasContext.drawImage(video, 0, 0, zoneCanvas.width, zoneCanvas.height);
        const rgba = zoneCanvasContext.getImageData(0, 0, zoneCanvas.width, zoneCanvas.height).data;
        const current = new Uint8Array(zoneCanvas.width * zoneCanvas.height);
        for (let index = 0; index < current.length; index += 1) {
          const offset = index * 4;
          current[index] = (rgba[offset] * 3 + rgba[offset + 1] * 6 + rgba[offset + 2]) / 10;
        }
        const previous = zoneSamples.get(camera.id);
        zoneSamples.set(camera.id, current);
        if (!previous || previous.length !== current.length) continue;
        for (const zone of zones) {
          const left = Math.max(0, Math.floor((visibleLeft + zone.x * visibleWidth) * zoneCanvas.width));
          const top = Math.max(0, Math.floor((visibleTop + zone.y * visibleHeight) * zoneCanvas.height));
          const right = Math.min(zoneCanvas.width, Math.ceil((visibleLeft + (zone.x + zone.width) * visibleWidth) * zoneCanvas.width));
          const bottom = Math.min(zoneCanvas.height, Math.ceil((visibleTop + (zone.y + zone.height) * visibleHeight) * zoneCanvas.height));
          let changed = 0;
          let total = 0;
          for (let y = top; y < bottom; y += 1) {
            for (let x = left; x < right; x += 1) {
              const pixel = y * zoneCanvas.width + x;
              if (Math.abs(current[pixel] - previous[pixel]) >= 30) changed += 1;
              total += 1;
            }
          }
          const key = `${camera.id}:${zone.id}`;
          const hitCount = total && changed / total >= Number(state.settings.zoneSensitivity) / 100
            ? (zoneHitCounts.get(key) || 0) + 1 : 0;
          zoneHitCounts.set(key, hitCount);
          if (hitCount < 2) continue;
          zoneHitCounts.set(key, 0);
          const lastAlarm = zoneAlarmAt.get(key) || 0;
          if (Date.now() - lastAlarm < 30_000) continue;
          zoneAlarmAt.set(key, Date.now());
          triggerRestrictedZoneAlarm(camera, zone);
        }
      } catch (error) {
        if (!unavailableZoneCameras.has(camera.id)) {
          unavailableZoneCameras.add(camera.id);
          console.warn(`Restricted-zone sampling failed for ${camera.name}:`, error);
          notify(`Zone monitoring is unavailable for ${camera.name}; browser security or stream format prevented frame analysis.`, "warning");
        }
      }
    }
  }

  async function triggerRestrictedZoneAlarm(camera, zone) {
    const occurredAt = new Date().toISOString();
    const zoneName = String(zone.name || "Restricted area").slice(0, 80);
    const message = `Motion in ${zoneName} at ${camera.name}`;
    notify(`Restricted area alert: ${message}`, "warning", 8000);
    if (state.settings.alarmToneEnabled && !state.settings.muted) playAlarmTone();
    if (state.settings.alarmVoiceEnabled) speakAlert(message, "alarm", `zone-${camera.id}-${zone.id}-${Math.floor(Date.now() / 30_000)}`, true);
    addAnalyticsEvent({
      cameraId: camera.id, category: "motion", summary: `Restricted area: ${zoneName}`,
      severity: "high", source: "browser-zone-monitor",
    }).catch((error) => {
      console.error("Restricted-zone event could not be stored:", error);
      notify("Zone alarm sounded, but its event could not be saved locally.", "error");
    });
    const endpoint = state.settings.alarmWebhookUrl;
    if (!endpoint) return;
    try {
      const url = validateWebUrl(endpoint, "Alarm bridge URL", true);
      const response = await fetchWithTimeout(url, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ event: "restricted-zone-motion", cameraId: camera.id, cameraName: camera.name, zoneName, occurredAt }),
      }, 5000);
      if (!response.ok) throw new Error(`Alarm bridge returned HTTP ${response.status}.`);
    } catch (error) {
      console.error("Alarm bridge notification failed:", error);
      notify(`Local alarm worked, but the alarm bridge could not be reached: ${error.message}`, "warning", 6500);
    }
  }

  function playAlarmTone() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume().catch((error) => console.warn("Alarm audio remains blocked:", error));
      const start = audioContext.currentTime;
      for (let pulse = 0; pulse < 3; pulse += 1) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const at = start + pulse * 0.28;
        oscillator.type = "sine";
        oscillator.frequency.value = pulse % 2 ? 660 : 880;
        gain.gain.setValueAtTime(0.001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.21);
      }
    } catch (error) {
      console.warn("Dashboard alarm tone could not play:", error);
      notify("The dashboard could not play its alarm tone. Check device audio and browser permissions.", "warning");
    }
  }

  function selectedCamera() {
    const allowedCameras = camerasVisibleToCurrentUser();
    return allowedCameras.find((camera) => camera.id === state.selectedCameraId)
      || allowedCameras.find((camera) => camera.enabled !== false);
  }

  async function refreshData() {
    const [cameras, events, sessions, snapshots] = await Promise.all([
      dbAll("cameras"), dbAll("events"), dbAll("sessions"), dbAll("snapshots"),
    ]);
    state.cameras = cameras.sort((a, b) => a.sortOrder - b.sortOrder);
    state.events = events;
    state.sessions = sessions;
    state.snapshots = snapshots;
    if (!cameraById(state.selectedCameraId)) state.selectedCameraId = state.cameras.find((camera) => camera.enabled)?.id || "";
    await refreshStorageInfo();
  }

  async function pruneAnalyticsCache() {
    if (state.events.length <= MAX_ANALYTICS_EVENTS) return;
    state.events.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    const removed = state.events.splice(MAX_ANALYTICS_EVENTS);
    const tx = db.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    removed.forEach((event) => store.delete(event.id));
    await transactionDone(tx);
  }

  async function refreshStorageInfo() {
    if (!navigator.storage?.estimate) {
      state.storage = null;
      return;
    }
    try {
      const estimate = await navigator.storage.estimate();
      const usage = Number(estimate.usage || 0);
      const quota = Number(estimate.quota || 0);
      state.storage = { usage, quota, percent: quota ? (usage / quota) * 100 : 0 };
      if (quota && usage / quota >= STORAGE_WARNING && Date.now() - storageWarningAt > 3_600_000) {
        storageWarningAt = Date.now();
        notify("Browser storage is getting full. Review retention and export important clips.", "warning");
      } else if (quota && usage / quota < STORAGE_WARNING) storageWarningAt = 0;
    } catch (error) {
      state.storage = null;
      console.warn("Storage estimate unavailable:", error);
    }
  }

  async function addAnalyticsEvent(input) {
    const categories = new Set(["motion", "license-plate", "known-face", "unknown-face", "access", "system"]);
    if (!input || !categories.has(input.category)) throw new Error("Unsupported analytics event category.");
    const occurredAt = new Date(input.occurredAt || Date.now());
    if (Number.isNaN(occurredAt.getTime())) throw new Error("Event timestamp is invalid.");
    const confidence = input.confidence == null || input.confidence === "" ? null : Number(input.confidence);
    if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new Error("Event confidence must be between 0 and 1.");
    const cameraId = String(input.cameraId || "").slice(0, 160);
    const summary = String(input.summary || "Detection event").slice(0, 240);
    const event = {
      id: String(input.id || (input.source === "analytics-feed" ? `feed-${cameraId}-${input.category}-${occurredAt.getTime()}-${summary}` : id("event"))).slice(0, 160),
      cameraId,
      cameraName: String(input.cameraName || "").slice(0, 100),
      category: input.category,
      occurredAt: occurredAt.toISOString(),
      summary,
      label: String(input.label || input.plateText || "").slice(0, 80),
      plateText: input.category === "license-plate" ? String(input.plateText || input.label || "").slice(0, 32) : "",
      confidence,
      severity: ["low", "medium", "high"].includes(input.severity) ? input.severity : "medium",
      source: String(input.source || "local").slice(0, 80),
      snapshotId: input.snapshotId ? String(input.snapshotId).slice(0, 160) : "",
    };
    await dbPut("events", event);
    state.events = [event, ...state.events.filter((item) => item.id !== event.id)];
    if (state.events.length > MAX_ANALYTICS_EVENTS) {
      state.events.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
      const expired = state.events.splice(MAX_ANALYTICS_EVENTS);
      await Promise.all(expired.map((item) => dbDelete("events", item.id)));
    }
    return event;
  }

  function normalizeFeedEvent(input) {
    if (!input || typeof input !== "object") throw new Error("Event must be an object.");
    const aliases = { plate: "license-plate", lpr: "license-plate", face: "known-face", unknown: "unknown-face", motion: "motion" };
    const rawCategory = String(input.category || input.type || "").toLowerCase().replace(/ /g, "-");
    const category = aliases[rawCategory] || rawCategory;
    const camera = state.cameras.find((item) => item.id === input.cameraId || item.name === input.cameraName || item.streamKey === input.camera);
    return {
      id: input.id || input.eventId,
      cameraId: camera?.id || input.cameraId || "",
      cameraName: input.cameraName,
      category,
      occurredAt: input.occurredAt || input.timestamp || new Date().toISOString(),
      summary: input.summary || input.description || `${category} event`,
      label: input.label || input.plateText || "",
      confidence: input.confidence == null ? null : Number(input.confidence) > 1 ? Number(input.confidence) / 100 : Number(input.confidence),
      severity: input.severity,
      source: input.source || "analytics-feed",
      snapshotId: input.snapshotId,
    };
  }

  async function syncAnalytics() {
    if (!isAdmin()) return;
    const endpoint = String(state.settings.analyticsUrl || "").trim();
    if (!endpoint) {
      notify("Add an analytics feed URL in Settings to sync external events.", "warning");
      return;
    }
    if (state.analyticsBusy) return;
    state.analyticsBusy = true;
    try {
      const url = new URL(endpoint, location.href);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Analytics feed must use HTTP or HTTPS.");
      if (url.username || url.password) throw new Error("Do not embed analytics credentials in the feed URL.");
      if (location.protocol === "https:" && url.protocol !== "https:") throw new Error("An HTTPS dashboard cannot load an insecure HTTP feed.");
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" }, credentials: "same-origin" }, 12000);
      if (!response.ok) throw new Error(`Analytics feed returned HTTP ${response.status}.`);
      if (Number(response.headers.get("content-length") || 0) > 5_000_000) throw new Error("Analytics feed response exceeds the 5 MB safety limit.");
      const responseText = await response.text();
      if (responseText.length > 5_000_000) throw new Error("Analytics feed response exceeds the 5 MB safety limit.");
      const payload = JSON.parse(responseText);
      const records = Array.isArray(payload) ? payload : payload?.events;
      if (!Array.isArray(records)) throw new Error("Analytics feed must return an event array.");
      let imported = 0;
      let spokenThisSync = 0;
      for (const record of records.slice(0, 500)) {
        try {
          const normalized = normalizeFeedEvent(record);
          const alreadyStored = state.events.some((item) => item.id === normalized.id
            || (normalized.source === "analytics-feed" && item.cameraId === normalized.cameraId
              && item.category === normalized.category && item.occurredAt === new Date(normalized.occurredAt).toISOString()
              && item.summary === String(normalized.summary || "").slice(0, 240)));
          const accepted = await addAnalyticsEvent(normalized);
          if (!alreadyStored && spokenThisSync < 3 && Date.now() - new Date(accepted.occurredAt).getTime() < 120_000) {
            speakAlert(`${accepted.category.replace("-", " ")} detection on ${cameraById(accepted.cameraId)?.name || accepted.cameraName || "camera"}`, accepted.severity, accepted.id);
            spokenThisSync += 1;
          }
          imported += 1;
        } catch (error) {
          console.warn("Analytics feed record rejected:", error);
        }
      }
      state.analyticsLastSync = Date.now();
      if (state.view === "analytics") render();
      notify(`Analytics sync complete: ${imported} event${imported === 1 ? "" : "s"} accepted.`);
    } catch (error) {
      notify(`Analytics sync failed: ${error.message}`, "error");
      console.error("Analytics feed error:", error);
    } finally {
      state.analyticsBusy = false;
    }
  }

  function scheduleAnalyticsPoll() {
    clearInterval(analyticsTimer);
    if (isAdmin() && state.settings.analyticsUrl) {
      analyticsTimer = window.setInterval(() => {
        if (document.visibilityState === "visible" && state.auth === "unlocked" && isAdmin()) syncAnalytics();
      }, Number(state.settings.analyticsPollSeconds) * 1000);
    }
  }

  async function captureSnapshot(cameraId) {
    if (!requireAdmin()) return;
    const camera = cameraById(cameraId);
    const video = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
    if (!camera || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      notify("A live video frame is not available for this camera.", "warning");
      return;
    }
    try {
      await refreshStorageInfo();
      if (state.storage?.quota && state.storage.usage / state.storage.quota >= STORAGE_LIMIT) {
        const removed = await pruneExpiredData(false);
        if (removed) await refreshStorageInfo();
        if (state.storage?.quota && state.storage.usage / state.storage.quota >= STORAGE_LIMIT) {
          throw new Error("Browser storage is nearly full. Clean up saved data before taking more snapshots.");
        }
      }
      const maxWidth = 1920;
      const ratio = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * ratio);
      canvas.height = Math.round(video.videoHeight * ratio);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Snapshot canvas is unavailable.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("JPEG encoding failed.")), "image/jpeg", 0.82));
      const capturedAt = new Date().toISOString();
      const snapshot = { id: id("snapshot"), cameraId, capturedAt, mimeType: "image/jpeg", blob, byteLength: blob.size, width: canvas.width, height: canvas.height };
      await dbPut("snapshots", snapshot);
      state.snapshots = [snapshot, ...state.snapshots];
      await refreshStorageInfo();
      const url = URL.createObjectURL(blob);
      state.modal = { type: "snapshot", url, filename: `${camera.name.replace(/[^a-z0-9_-]/gi, "_")}-${capturedAt.replace(/[:.]/g, "-")}.jpg`, message: `Saved locally · ${formatDate(capturedAt, true)} · ${formatBytes(blob.size)}` };
      renderModal();
      notify("JPEG snapshot saved in local browser storage.");
    } catch (error) {
      notify(`Snapshot failed: ${error.message}`, "error");
      console.error("Snapshot capture failed:", error);
    }
  }

  async function startRecording(cameraId) {
    if (!requireAdmin()) return;
    if (state.recording) {
      notify("Only one focused camera recording is supported at a time.", "warning");
      return;
    }
    const session = media.get(cameraId);
    const video = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
    if (!session || session.status !== "connected" || !video?.srcObject) {
      notify("Connect and focus a live camera before recording.", "warning");
      return;
    }
    if (!window.MediaRecorder) {
      notify("MediaRecorder is not supported in this browser.", "error");
      return;
    }
    await pruneExpiredData(false);
    await refreshStorageInfo();
    if (state.storage?.quota && state.storage.usage / state.storage.quota >= STORAGE_LIMIT) {
      notify("Browser storage is nearly full. Clean up recordings before starting.", "error");
      return;
    }
    const candidates = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      notify("No supported WebM recording format was found.", "error");
      return;
    }
    const camera = cameraById(cameraId);
    const sessionId = id("recording");
    const recordSession = {
      id: sessionId, cameraId, cameraName: camera.name, startedAt: new Date().toISOString(),
      endedAt: "", mimeType, status: "recording", bytes: 0, chunkCount: 0,
    };
    const recorder = new MediaRecorder(video.srcObject, { mimeType });
    state.recording = { id: sessionId, cameraId, recorder, recordSession };
    try {
      await dbPut("sessions", recordSession);
      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        recordingWriteChain = recordingWriteChain.then(() => persistRecordingChunk(sessionId, cameraId, event.data))
          .catch(async (error) => {
            try { await pruneExpiredData(true); } catch (cleanupError) { console.error("Automatic retention cleanup failed:", cleanupError); }
            notify(`Recording chunk could not be saved: ${error.message}`, "error");
            stopRecording("storage-error");
          });
      };
      recorder.onerror = (event) => {
        notify("The browser reported a recording error.", "error");
        console.error("MediaRecorder error:", event.error || event);
        stopRecording("recorder-error");
      };
      recorder.onstop = () => {
        finalizeRecording(finalizingReasons.get(sessionId) || "stopped", sessionId).catch((error) => {
          console.error("Recording finalization failed:", error);
          notify("Recording stopped, but session metadata could not be finalized.", "error");
        });
      };
      recorder.start(CHUNK_MS);
      render();
      notify("Recording started. Chunks are saved approximately once per minute.");
    } catch (error) {
      state.recording = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
      notify(`Recording could not start: ${error.message}`, "error");
    }
  }

  async function persistRecordingChunk(sessionId, cameraId, blob) {
    const persisted = await dbGet("sessions", sessionId);
    const endedAt = new Date();
    const startedAt = new Date(persisted?.lastChunkAt || persisted?.startedAt || endedAt.toISOString());
    const chunk = {
      id: id("chunk"), sessionId, cameraId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
      mimeType: blob.type || "video/webm", byteLength: blob.size,
      sequence: persisted?.chunkCount || 0, blob, complete: true,
    };
    await dbPut("chunks", chunk);
    if (persisted) {
      persisted.bytes = (persisted.bytes || 0) + blob.size;
      persisted.chunkCount = (persisted.chunkCount || 0) + 1;
      persisted.lastChunkAt = endedAt.toISOString();
      await dbPut("sessions", persisted);
      if (state.recording?.id === sessionId) state.recording.recordSession = persisted;
    }
    await refreshStorageInfo();
    if (state.storage?.quota && state.storage.usage / state.storage.quota >= STORAGE_WARNING) {
      const removed = await pruneExpiredData(true);
      if (removed) await refreshStorageInfo();
    }
    if (state.storage?.quota && state.storage.usage / state.storage.quota >= STORAGE_LIMIT) {
      notify("Storage limit reached. Recording will stop to protect browser data.", "error");
      window.setTimeout(() => stopRecording("quota-stop"), 0);
    }
  }

  function stopRecording(reason = "stopped") {
    const current = state.recording;
    if (!current) return;
    current.stopReason = reason;
    finalizingReasons.set(current.id, reason);
    if (current.recorder.state !== "inactive") current.recorder.stop();
    else finalizeRecording(reason, current.id).catch((error) => console.error(error));
    state.recording = null;
    render();
  }

  async function finalizeRecording(status, fixedSessionId = "") {
    const current = state.recording;
    const sessionId = fixedSessionId || current?.id || state.finalizingSessionId;
    if (!sessionId) return;
    state.finalizingSessionId = sessionId;
    await recordingWriteChain;
    const recordSession = await dbGet("sessions", sessionId);
    if (recordSession) {
      recordSession.endedAt = new Date().toISOString();
      recordSession.status = status;
      await dbPut("sessions", recordSession);
    }
    finalizingReasons.delete(sessionId);
    state.finalizingSessionId = "";
    if (state.recording?.id === sessionId) state.recording = null;
    state.sessions = await dbAll("sessions");
    if (state.auth === "unlocked") render();
  }

  async function loadSessionPlayback(sessionId) {
    try {
      const tx = db.transaction("chunks", "readonly");
      const request = tx.objectStore("chunks").index("sessionId").getAll(sessionId);
      const chunks = await requestResult(request);
      if (!chunks.length) throw new Error("No saved chunks were found for this session.");
      chunks.sort((a, b) => a.sequence - b.sequence);
      const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: chunks[0].mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      state.modal.playerUrl = url;
      const video = document.getElementById("recording-player");
      const link = document.getElementById("download-recording");
      if (!video || !link) {
        URL.revokeObjectURL(url);
        return;
      }
      video.src = url;
      video.dataset.objectUrl = url;
      link.href = url;
      link.download = `sentinel-${sessionId}.webm`;
      video.play().catch(() => {});
    } catch (error) {
      notify(`Recording playback failed: ${error.message}`, "error");
      console.error("Playback failed:", error);
    }
  }

  async function deleteSession(sessionId) {
    const chunkKeys = await requestResult(db.transaction("chunks", "readonly").objectStore("chunks").index("sessionId").getAllKeys(sessionId));
    const tx = db.transaction(["chunks", "sessions"], "readwrite");
    const chunksStore = tx.objectStore("chunks");
    chunkKeys.forEach((key) => chunksStore.delete(key));
    tx.objectStore("sessions").delete(sessionId);
    await transactionDone(tx);
    state.sessions = state.sessions.filter((session) => session.id !== sessionId);
    render();
    notify("Recording session and its saved chunks were deleted.");
  }

  async function pruneExpiredData(showNotification) {
    const cutoff = Date.now() - Number(state.settings.retentionDays) * 86400000;
    const sessions = await dbAll("sessions");
    const eligible = sessions.filter((session) => session.id !== state.recording?.id && new Date(session.startedAt).getTime() < cutoff);
    const snapshots = await dbAll("snapshots");
    const expiredSnapshots = snapshots.filter((snapshot) => new Date(snapshot.capturedAt).getTime() < cutoff);
    if (!eligible.length && !expiredSnapshots.length) return 0;
    const allChunks = await dbAll("chunks");
    const eligibleIds = new Set(eligible.map((session) => session.id));
    const snapshotIds = new Set(expiredSnapshots.map((snapshot) => snapshot.id));
    const tx = db.transaction(["chunks", "sessions", "snapshots"], "readwrite");
    const chunkStore = tx.objectStore("chunks");
    for (const chunk of allChunks) {
      if (eligibleIds.has(chunk.sessionId)) chunkStore.delete(chunk.id);
    }
    for (const session of eligible) {
      tx.objectStore("sessions").delete(session.id);
    }
    for (const snapshotId of snapshotIds) tx.objectStore("snapshots").delete(snapshotId);
    await transactionDone(tx);
    state.sessions = await dbAll("sessions");
    state.snapshots = await dbAll("snapshots");
    await refreshStorageInfo();
    const removed = eligible.length + expiredSnapshots.length;
    if (showNotification) notify(`Retention cleanup removed ${eligible.length} recording session(s) and ${expiredSnapshots.length} snapshot(s).`);
    return removed;
  }

  async function cleanupOldRecordings() {
    const removed = await pruneExpiredData(false);
    render();
    if (removed) notify(`Retention cleanup removed ${removed} expired item${removed === 1 ? "" : "s"}.`);
    else notify("No recordings or snapshots are older than the configured retention period.", "warning");
  }

  async function sha256(value) {
    if (!crypto.subtle) throw new Error("Secure Web Crypto is unavailable. Open the app over HTTPS or localhost to configure a PIN.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    let result = 0;
    for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return result === 0;
  }

  async function completePinEntry() {
    const pin = state.pinInput;
    if (pin.length !== 4) return;
    state.pinInput = "";
    authError = "";
    try {
      if (state.authStep === "setup" || (!localStorage.getItem(AUTH_KEY) && state.authStep !== "confirm")) {
        state.setupUsername = state.setupUsername.trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,32}$/.test(state.setupUsername)) {
          authError = "Use a 3–32 character username with letters, numbers, dot, underscore, or hyphen.";
          renderAuth();
          return;
        }
        state.firstPin = pin;
        state.authStep = "confirm";
        authError = "";
        renderAuth();
        return;
      }
      if (state.authStep === "confirm") {
        if (pin !== state.firstPin) {
          state.firstPin = "";
          state.authStep = "setup";
          authError = "PINs did not match. Start again.";
          renderAuth();
          return;
        }
        const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const digest = await sha256(`${salt}:${pin}`);
        state.accounts = [{
          username: state.setupUsername,
          role: "admin",
          salt,
          digest,
          createdAt: new Date().toISOString(),
        }];
        persistAccounts();
        state.currentUser = { username: state.setupUsername, role: "admin" };
        state.firstPin = "";
        state.authStep = "unlock";
        state.auth = "unlocked";
        authFailures = 0;
        authError = "";
        recordAccess(state.setupUsername, "admin", "success");
        render();
        scheduleAnalyticsPoll();
        scheduleViewerUsage();
        if (state.settings.analyticsUrl && isAdmin()) syncAnalytics();
        recordActivity();
        notify("Administrator account created. Local accounts do not replace server-side authentication.");
        return;
      }
      if (Date.now() < lockoutUntil) {
        authError = `Try again in ${Math.ceil((lockoutUntil - Date.now()) / 1000)} seconds.`;
        renderAuth();
        return;
      }
      const stored = readAuthRecord();
      if (!stored) throw new Error("No local accounts are configured. Reload and set up an administrator.");
      const username = state.authUsername.trim().toLowerCase();
      const account = stored.accounts.find((item) => item.username === username);
      const salt = account?.salt || "00000000000000000000000000000000";
      const expectedDigest = account?.digest || "0".repeat(64);
      const digest = await sha256(`${salt}:${pin}`);
      if (!account || !constantTimeEqual(digest, expectedDigest)) {
        authFailures += 1;
        if (authFailures >= 5) {
          lockoutUntil = Date.now() + Math.min(60_000, 5000 * (authFailures - 4));
          authFailures = 0;
        }
        recordAccess(username || "unknown", account?.role || "unknown", "failed");
        authError = "PIN is incorrect.";
        renderAuth();
        return;
      }
      authFailures = 0;
      state.accounts = stored.accounts;
      state.currentUser = { username: account.username, role: account.role };
      state.auth = "unlocked";
      state.authStep = "unlock";
      authError = "";
      state.view = "grid";
      state.layoutEditMode = false;
      ensureCameraSelectionForCurrentUser();
      recordAccess(account.username, account.role, "success");
      render();
      scheduleAnalyticsPoll();
      scheduleViewerUsage();
      if (state.settings.analyticsUrl) syncAnalytics();
      recordActivity();
      notify(`Signed in as ${account.role === "admin" ? "administrator" : "viewer"}.`);
    } catch (error) {
      authError = error.message || "PIN operation failed.";
      renderAuth();
      console.error("PIN operation failed:", error);
    }
  }

  function addPinDigit(value) {
    if (state.pinInput.length >= 4) return;
    if (!/^\d$/.test(value)) return;
    state.pinInput += value;
    authError = "";
    renderAuth();
    if (state.pinInput.length === 4) window.setTimeout(() => completePinEntry(), 80);
  }

  function lockSystem() {
    if (state.auth !== "unlocked") return;
    updateViewerUsage();
    clearTimeout(idleTimer);
    clearInterval(usageTimer);
    clearInterval(zoneMonitorTimer);
    zoneMonitorTimer = undefined;
    lastUsageTick = 0;
    if (state.recording) stopRecording("system-locked");
    for (const cameraId of [...media.keys()]) closeCamera(cameraId);
    speechQueue.length = 0;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    speechInProgress = false;
    if (state.modal) closeModal();
    state.auth = "locked";
    state.currentUser = null;
    state.authUsername = "";
    state.view = "grid";
    state.layoutEditMode = false;
    state.zoneDrawingCameraId = "";
    state.zoneDraft = null;
    state.zoneNameDraft = "";
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch((error) => console.warn("Alarm audio context could not close:", error));
      audioContext = undefined;
    }
    state.pinInput = "";
    authError = "";
    render();
  }

  function recordActivity() {
    if (state.auth !== "unlocked") return;
    updateIdleTimer();
  }

  function updateIdleTimer() {
    clearTimeout(idleTimer);
    const minutes = Number(state.settings.autoLockMinutes);
    if (state.auth === "unlocked" && minutes > 0) {
      idleTimer = window.setTimeout(lockSystem, minutes * 60_000);
    }
  }

  function beginZoneDrawing(cameraId) {
    if (!requireAdmin()) return;
    if (!cameraById(cameraId)) {
      notify("Choose a camera before drawing a restricted area.", "warning");
      return;
    }
    state.zoneNameDraft = String(document.getElementById("zoneName")?.value || state.zoneNameDraft).trim().slice(0, 80);
    state.zoneDrawingCameraId = cameraId;
    state.zoneDraft = null;
    state.view = "grid";
    state.settings.gridMode = "grid";
    state.selectedCameraId = cameraId;
    state.layoutEditMode = false;
    saveSettings();
    window.scrollTo(0, 0);
    render();
    window.setTimeout(() => {
      document.querySelector(`[data-stage="${CSS.escape(cameraId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector(`[data-zone-canvas="${CSS.escape(cameraId)}"]`)?.focus({ preventScroll: true });
      scheduleStreamSync();
    }, 0);
  }

  function zoneCoordinates(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function onZonePointerDown(event) {
    const canvas = event.target.closest?.(".zone-canvas");
    if (!canvas || !state.zoneDrawingCameraId) return;
    const point = zoneCoordinates(event, canvas);
    state.zoneDraft = { cameraId: canvas.dataset.zoneCanvas, pointerId: event.pointerId, startX: point.x, startY: point.y, x: point.x, y: point.y, width: 0.001, height: 0.001 };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function onZonePointerMove(event) {
    const draft = state.zoneDraft;
    if (!draft || draft.pointerId !== event.pointerId) return;
    const canvas = document.querySelector(`[data-zone-canvas="${CSS.escape(draft.cameraId)}"]`);
    if (!canvas) return;
    const point = zoneCoordinates(event, canvas);
    const left = Math.min(draft.startX, point.x);
    const top = Math.min(draft.startY, point.y);
    const width = Math.abs(point.x - draft.startX);
    const height = Math.abs(point.y - draft.startY);
    Object.assign(draft, { x: left, y: top, width, height });
    const rect = canvas.querySelector(".zone-draft");
    if (rect) {
      rect.classList.add("active");
      rect.style.left = `${left * 100}%`;
      rect.style.top = `${top * 100}%`;
      rect.style.width = `${width * 100}%`;
      rect.style.height = `${height * 100}%`;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  async function onZonePointerUp(event) {
    const draft = state.zoneDraft;
    if (!draft || draft.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const camera = cameraById(draft.cameraId);
    state.zoneDraft = null;
    suppressNextZoneClick = true;
    window.setTimeout(() => { suppressNextZoneClick = false; }, 250);
    await saveRestrictedZone(camera, draft);
  }

  async function saveRestrictedZone(camera, draft) {
    if (!camera || draft.width < 0.035 || draft.height < 0.035) {
      render();
      notify("Draw a larger area inside the camera image (at least 3.5% in each direction).", "warning");
      return;
    }
    const existingZones = safeRestrictedZones(camera);
    if (existingZones.length >= 20) {
      render();
      notify("A camera can have at most 20 restricted areas.", "warning");
      return;
    }
    const zone = {
      id: id("zone"),
      name: (state.zoneNameDraft || `Restricted area ${existingZones.length + 1}`).slice(0, 80),
      x: draft.x, y: draft.y, width: draft.width, height: draft.height, enabled: true,
    };
    const previous = existingZones;
    camera.restrictedZones = [...previous, zone];
    try {
      await dbPut("cameras", camera);
      state.zoneDrawingCameraId = "";
      state.zoneNameDraft = "";
      render();
      notify(`Restricted area “${zone.name}” saved on ${camera.name}.`);
    } catch (error) {
      camera.restrictedZones = previous;
      console.error("Restricted area could not be stored:", error);
      render();
      notify(`Restricted area could not be saved: ${error.message}`, "error");
    }
  }

  function onZonePointerCancel(event) {
    if (!state.zoneDraft || state.zoneDraft.pointerId !== event.pointerId) return;
    state.zoneDraft = null;
    render();
  }

  async function removeRestrictedZone(cameraId, zoneId) {
    const camera = cameraById(cameraId);
    if (!camera) return;
    const previous = safeRestrictedZones(camera);
    camera.restrictedZones = previous.filter((zone) => zone.id !== zoneId);
    try {
      await dbPut("cameras", camera);
      zoneHitCounts.delete(`${cameraId}:${zoneId}`);
      zoneAlarmAt.delete(`${cameraId}:${zoneId}`);
      render();
      notify("Restricted area removed.");
    } catch (error) {
      camera.restrictedZones = previous;
      console.error("Restricted area could not be removed:", error);
      notify(`Restricted area could not be removed: ${error.message}`, "error");
    }
  }

  function openModal(modal) {
    focusBeforeModal = document.activeElement;
    state.modal = modal;
    renderModal();
  }

  function closeModal() {
    const modal = state.modal;
    if (modal?.url) URL.revokeObjectURL(modal.url);
    if (modal?.snapshotUrl) URL.revokeObjectURL(modal.snapshotUrl);
    const player = document.getElementById("recording-player");
    if (player?.dataset.objectUrl) URL.revokeObjectURL(player.dataset.objectUrl);
    if (modal?.playerUrl) URL.revokeObjectURL(modal.playerUrl);
    if (player) {
      player.pause();
      player.removeAttribute("src");
    }
    state.modal = null;
    const modalRoot = document.getElementById("modal-root");
    if (modalRoot) modalRoot.innerHTML = "";
    if (focusBeforeModal?.isConnected) focusBeforeModal.focus();
    focusBeforeModal = null;
  }

  function askConfirm(title, message, danger, onConfirm) {
    openModal({ type: "confirm", title, message, danger, onConfirm });
  }

  function openCameraEditor(camera = null) {
    openModal({ type: "camera", camera });
  }

  function resetLocalPin() {
    if (state.auth !== "unlocked") {
      if (!window.confirm("Remove all local accounts and set up a new administrator? Camera data, recordings, and access log remain.")) return;
      localStorage.removeItem(AUTH_KEY);
      state.accounts = [];
      state.currentUser = null;
      state.auth = "setup";
      state.authStep = "setup";
      state.pinInput = "";
      state.firstPin = "";
      renderAuth();
      return;
    }
    if (!requireAdmin()) return;
    askConfirm(
      "Reset all local accounts?",
      "This removes every local account. The next screen will create a new administrator. Camera data, recordings, and the local sign-in log remain stored.",
      true,
      () => {
        localStorage.removeItem(AUTH_KEY);
        state.accounts = [];
        if (state.auth === "unlocked") lockSystem();
        state.auth = "setup";
        state.authStep = "setup";
        state.setupUsername = "admin";
        state.pinInput = "";
        state.firstPin = "";
        closeModal();
        render();
      },
    );
  }

  function exportEventMetadata() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), warning: "Local cache; not an authoritative audit record.", events: state.events }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sentinel-events-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Event metadata export started. Review the file's sensitive contents before sharing.");
  }

  function speakAlert(message, priority = "normal", dedupeKey = message, force = false) {
    if ((!state.settings.voiceEnabled && !force) || state.settings.muted || !("speechSynthesis" in window) || state.auth !== "unlocked") return;
    const safeMessage = String(message).replace(/[\u0000-\u001f]/g, " ").slice(0, 140);
    if (!safeMessage || spokenKeys.has(dedupeKey)) return;
    spokenKeys.add(dedupeKey);
    if (spokenKeys.size > 500) spokenKeys.delete(spokenKeys.values().next().value);
    const priorityValue = priority === "alarm" ? 3 : priority === "high" ? 2 : priority === "medium" ? 1 : 0;
    speechQueue.push({ message: safeMessage, priority: priorityValue, createdAt: Date.now(), alarm: force });
    speechQueue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    if (speechQueue.length > 12) speechQueue.length = 12;
    processSpeechQueue();
  }

  function processSpeechQueue() {
    if (speechInProgress || !speechQueue.length || state.settings.muted || state.auth !== "unlocked"
      || (!state.settings.voiceEnabled && !speechQueue[0].alarm)) return;
    if (!("speechSynthesis" in window)) return;
    const next = speechQueue.shift();
    speechInProgress = true;
    try {
      const utterance = new SpeechSynthesisUtterance(next.message);
      utterance.rate = next.priority === 2 ? 1 : 1.08;
      utterance.volume = 0.8;
      const finish = () => {
        speechInProgress = false;
        processSpeechQueue();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      speechSynthesis.speak(utterance);
    } catch (error) {
      speechInProgress = false;
      console.warn("Voice alert could not be spoken:", error);
    }
  }

  function setMuted(value) {
    state.settings.muted = Boolean(value);
    if (state.settings.muted) {
      speechQueue.length = 0;
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      speechInProgress = false;
    }
    saveSettings();
    render();
  }

  function setView(view) {
    if (!isAdmin() && view !== "grid") {
      notify("Viewer accounts can access live cameras only.", "warning");
      return;
    }
    if (!["grid", "analytics", "recordings", "settings"].includes(view)) return;
    if (view !== "grid" && state.recording) stopRecording("view-changed");
    state.view = view;
    render();
    if (view === "analytics" && state.settings.analyticsUrl && !state.analyticsLastSync) syncAnalytics();
    if (view === "recordings") refreshStorageInfo().then(() => render());
  }

  function focusCamera(cameraId) {
    if (!cameraById(cameraId)) return;
    if (!canViewCamera(cameraId)) {
      notify("This camera has not been assigned to your viewer account.", "warning");
      return;
    }
    state.layoutEditMode = false;
    document.querySelector(`[data-action="focus-camera"][data-camera="${CSS.escape(cameraId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "auto" });
    if (state.recording && state.recording.cameraId !== cameraId) stopRecording("camera-changed");
    state.selectedCameraId = cameraId;
    state.settings.gridMode = "focus";
    saveSettings();
    render();
  }

  function canViewCamera(cameraId) {
    return isAdmin() || camerasForAccount(currentViewerAccount()).some((camera) => camera.id === cameraId);
  }

  async function moveCamera(cameraId, direction) {
    if (!requireAdmin()) return;
    const ordered = state.cameras.map((camera) => ({ ...camera })).sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((camera) => camera.id === cameraId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    ordered.forEach((camera, position) => { camera.sortOrder = position; });
    try {
      const tx = db.transaction("cameras", "readwrite");
      ordered.forEach((camera) => tx.objectStore("cameras").put(camera));
      await transactionDone(tx);
      state.cameras = ordered;
      render();
    } catch (error) {
      notify(`Camera position could not be saved: ${error.message}`, "error");
      console.error("Camera layout persistence failed:", error);
    }
  }

  async function cycleCameraSize(cameraId) {
    if (!requireAdmin()) return;
    const camera = cameraById(cameraId);
    if (!camera) return;
    const sizes = ["standard", "wide", "large"];
    const updated = { ...camera, layoutSize: sizes[(sizes.indexOf(camera.layoutSize || "standard") + 1) % sizes.length] };
    try {
      await dbPut("cameras", updated);
      Object.assign(camera, updated);
      render();
    } catch (error) {
      notify(`Camera size could not be saved: ${error.message}`, "error");
      console.error("Camera size persistence failed:", error);
    }
  }

  async function togglePictureInPicture() {
    if (!canViewCamera(state.selectedCameraId)) {
      notify("Select a camera assigned to your account before requesting picture-in-picture.", "warning");
      return;
    }
    const video = document.querySelector(`[data-video="${CSS.escape(state.selectedCameraId)}"]`);
    if (!video) {
      notify("Select a camera before requesting picture-in-picture.", "warning");
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && video.requestPictureInPicture) await video.requestPictureInPicture();
      else notify("Picture-in-picture is not supported on this browser/device.", "warning");
    } catch (error) {
      notify(`Picture-in-picture could not start: ${error.message}`, "error");
    }
  }

  function cameraFromForm(form) {
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const streamKey = String(values.get("streamKey") || "").trim();
    const substreamKey = String(values.get("substreamKey") || "").trim();
    if (!name) throw new Error("Camera name is required.");
    if (!streamKey || /\s/.test(streamKey)) throw new Error("Enter a valid go2rtc stream key without spaces.");
    if (/\s/.test(substreamKey)) throw new Error("Substream key must not contain spaces.");
    const existing = cameraById(String(values.get("id") || ""));
    return {
      id: existing?.id || id("camera"),
      name,
      location: String(values.get("location") || "").trim().slice(0, 100),
      streamKey: streamKey.slice(0, 160),
      substreamKey: substreamKey.slice(0, 160),
      enabled: true,
      sortOrder: existing?.sortOrder ?? state.cameras.length,
      layoutSize: existing?.layoutSize || "standard",
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function saveGatewaySettings(form) {
    const values = new FormData(form);
    let gatewayUrl = String(values.get("gatewayUrl") || "").trim();
    const analyticsUrl = String(values.get("analyticsUrl") || "").trim();
    if (gatewayUrl) {
      const parsed = new URL(gatewayUrl, location.href);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("Gateway must be an HTTP(S) base URL without embedded credentials.");
      }
      if (location.protocol === "https:" && parsed.protocol !== "https:") throw new Error("Use HTTPS for the gateway when the dashboard uses HTTPS.");
      if (parsed.search || parsed.hash) throw new Error("Gateway base URL cannot contain a query or fragment.");
      gatewayUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    }
    if (analyticsUrl) {
      const parsed = new URL(analyticsUrl, location.href);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Analytics feed must use HTTP or HTTPS.");
      if (parsed.username || parsed.password) throw new Error("Do not embed analytics credentials in the feed URL.");
      if (location.protocol === "https:" && parsed.protocol !== "https:") throw new Error("Use HTTPS for the analytics feed.");
    }
    const maxStreams = Number(values.get("maxStreams"));
    const autoLockMinutes = Number(values.get("autoLockMinutes"));
    const retentionDays = Number(values.get("retentionDays"));
    const analyticsPollSeconds = Number(values.get("analyticsPollSeconds"));
    if (![1,2,3,4,5,6,7,8,9].includes(maxStreams)) throw new Error("Select a supported stream budget.");
    if (![0,1,5,10,15,30,60].includes(autoLockMinutes)) throw new Error("Select a supported lock timeout.");
    if (![1,3,7,14,30,90].includes(retentionDays)) throw new Error("Select a supported retention period.");
    if (![15,30,60,300].includes(analyticsPollSeconds)) throw new Error("Select a supported analytics poll interval.");
    state.settings = {
      ...state.settings,
      gatewayUrl, analyticsUrl, maxStreams, autoLockMinutes, retentionDays, analyticsPollSeconds,
      voiceEnabled: values.get("voiceEnabled") === "on",
      muted: values.get("muted") === "on",
    };
    saveSettings();
    scheduleAnalyticsPoll();
    render();
    pruneExpiredData(false).catch((error) => console.error("Retention cleanup failed after settings update:", error));
    notify("Settings saved in this browser.");
  }

  function onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const cameraId = button.dataset.camera;
    if (suppressNextZoneClick && action === "focus-camera") {
      suppressNextZoneClick = false;
      event.preventDefault();
      return;
    }
    if (ADMIN_ONLY_ACTIONS.has(action) && !requireAdmin()) return;
    if (action === "backdrop-close") {
      if (event.target === button) closeModal();
      return;
    }
    if (action === "navigate") setView(button.dataset.view);
    else if (action === "select-camera" || action === "focus-camera") focusCamera(cameraId);
    else if (action === "add-camera") openCameraEditor();
    else if (action === "edit-camera") openCameraEditor(cameraById(cameraId));
    else if (action === "delete-camera") {
      const camera = cameraById(cameraId);
      if (!camera) return;
      askConfirm("Remove camera?", `Remove ${camera.name} from this browser registry? Saved recording and event history are retained.`, true, async () => {
        closeCamera(cameraId);
        if (state.recording?.cameraId === cameraId) stopRecording("camera-removed");
        await dbDelete("cameras", cameraId);
        state.cameras = state.cameras.filter((item) => item.id !== cameraId);
        if (state.selectedCameraId === cameraId) state.selectedCameraId = state.cameras[0]?.id || "";
        closeModal();
        render();
        notify("Camera removed. Previously saved local data was retained.");
      });
    } else if (action === "connect-camera") connectCamera(cameraId, true);
    else if (action === "activate-video") {
      const video = document.querySelector(`[data-video="${CSS.escape(cameraId)}"]`);
      video?.play().then(() => streamStatus(cameraId, "connected", "")).catch((error) => {
        notify(`Video playback could not start: ${error.message}`, "warning");
      });
    }
    else if (action === "disconnect-camera") {
      if (state.recording?.cameraId === cameraId) stopRecording("stream-stopped");
      closeCamera(cameraId);
    } else if (action === "snapshot") captureSnapshot(cameraId);
    else if (action === "toggle-recording") {
      if (state.recording?.cameraId === cameraId) stopRecording("operator-stop");
      else if (state.recording) notify("Stop the current recording before starting another.", "warning");
      else if (state.selectedCameraId !== cameraId) notify("Focus this camera first, then start recording.", "warning");
      else startRecording(cameraId);
    } else if (action === "grid-mode") {
      state.settings.gridMode = state.settings.gridMode === "grid" ? "focus" : "grid";
      saveSettings();
      render();
    } else if (action === "layout-edit") {
      state.layoutEditMode = !state.layoutEditMode;
      render();
    } else if (action === "move-camera") {
      moveCamera(cameraId, button.dataset.direction);
    } else if (action === "camera-size") {
      cycleCameraSize(cameraId);
    } else if (action === "draw-zone") {
      beginZoneDrawing(cameraId);
    } else if (action === "cancel-zone") {
      state.zoneDrawingCameraId = "";
      state.zoneDraft = null;
      state.zoneNameDraft = "";
      render();
    } else if (action === "delete-zone") {
      removeRestrictedZone(cameraId, button.dataset.zone).catch((error) => {
        console.error("Restricted area removal failed:", error);
        notify("Restricted area removal failed.", "error");
      });
    } else if (action === "copy-user-link") {
      const url = new URL(location.href);
      url.hash = "";
      url.searchParams.set("user", button.dataset.username);
      if (!navigator.clipboard?.writeText) {
        notify(`Copy this app link manually: ${url.toString()}`, "warning", 9000);
        return;
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        notify(`App link copied for ${button.dataset.username}. It only prefills the username; the local account must exist in that browser.`);
      }).catch((error) => {
        console.error("Viewer link could not be copied:", error);
        notify(`Copy this app link manually: ${url.toString()}`, "warning", 9000);
      });
    } else if (action === "test-alarm") {
      if (state.settings.alarmToneEnabled && !state.settings.muted) playAlarmTone();
      if (state.settings.alarmVoiceEnabled) speakAlert("This is a restricted area alarm test", "alarm", `alarm-test-${Date.now()}`, true);
      notify("Local alarm test started. Check this device's speakers and speech settings.", "warning");
    } else if (action === "analytics-filter") {
      state.analyticsFilter = button.dataset.filter;
      render();
    } else if (action === "add-event") openModal({ type: "event" });
    else if (action === "event-detail") openModal({ type: "event-detail", eventId: button.dataset.event });
    else if (action === "sync-analytics") syncAnalytics();
    else if (action === "refresh-storage") refreshStorageInfo().then(() => render());
    else if (action === "cleanup-recordings") askConfirm("Apply retention cleanup?", `Delete recordings and snapshots older than ${state.settings.retentionDays} days? This cannot be undone.`, true, async () => { closeModal(); await cleanupOldRecordings(); });
    else if (action === "play-session") openModal({ type: "player", sessionId: button.dataset.session });
    else if (action === "view-snapshot") {
      dbGet("snapshots", button.dataset.snapshot).then((snapshot) => {
        if (!snapshot) throw new Error("Snapshot is no longer available.");
        const camera = cameraById(snapshot.cameraId);
        openModal({
          type: "snapshot",
          url: URL.createObjectURL(snapshot.blob),
          filename: `${(camera?.name || "camera").replace(/[^a-z0-9_-]/gi, "_")}-${snapshot.capturedAt.replace(/[:.]/g, "-")}.jpg`,
          message: `${formatDate(snapshot.capturedAt, true)} · ${snapshot.width || "?"} × ${snapshot.height || "?"} · ${formatBytes(snapshot.byteLength)}`,
        });
      }).catch((error) => notify(error.message, "error"));
    } else if (action === "delete-snapshot") {
      const snapshotId = button.dataset.snapshot;
      askConfirm("Delete snapshot?", "Delete this JPEG from local storage? Related event metadata will remain.", true, async () => {
        await dbDelete("snapshots", snapshotId);
        state.snapshots = state.snapshots.filter((snapshot) => snapshot.id !== snapshotId);
        closeModal();
        render();
        notify("Snapshot deleted.");
      });
    }
    else if (action === "delete-session") {
      const session = state.sessions.find((item) => item.id === button.dataset.session);
      if (session?.id === state.recording?.id) {
        notify("Stop the active recording before deleting it.", "warning");
        return;
      }
      askConfirm("Delete recording?", "Delete this session and all its stored chunks? This cannot be undone.", true, async () => { closeModal(); await deleteSession(button.dataset.session); });
    } else if (action === "close-modal") closeModal();
    else if (action === "confirm-modal") {
      const callback = state.modal?.onConfirm;
      Promise.resolve(callback?.()).catch((error) => {
        notify(`Operation failed: ${error.message}`, "error");
        console.error(error);
      });
    } else if (action === "lock") lockSystem();
    else if (action === "logout") {
      lockSystem();
      notify("Signed out.");
    }
    else if (action === "mute") setMuted(!state.settings.muted);
    else if (action === "pin-key") {
      const key = button.dataset.key;
      if (key === "C") state.pinInput = "";
      else if (key === "⌫") state.pinInput = state.pinInput.slice(0, -1);
      else addPinDigit(key);
      renderAuth();
      if (state.pinInput.length === 4) window.setTimeout(completePinEntry, 80);
    } else if (action === "reset-pin") resetLocalPin();
    else if (action === "delete-user") {
      const username = button.dataset.username;
      if (!state.accounts.some((account) => account.username === username && account.role === "user")) return;
      askConfirm("Remove viewer account?", `Remove the local viewer account “${username}”? This does not delete camera data.`, true, () => {
        const previousAccounts = state.accounts;
        state.accounts = state.accounts.filter((account) => account.username !== username);
        try {
          persistAccounts();
        } catch (error) {
          state.accounts = previousAccounts;
          throw error;
        }
        closeModal();
        render();
        notify(`Viewer account ${username} removed.`);
      });
    }
    else if (action === "export-data") exportEventMetadata();
    else if (action === "reset-app") askConfirm("Reset camera setup?", "Remove all camera registry entries? Saved recordings, snapshots, events, and the local PIN remain.", true, async () => {
      if (state.recording) stopRecording("camera-reset");
      const tx = db.transaction("cameras", "readwrite");
      tx.objectStore("cameras").clear();
      await transactionDone(tx);
      for (const cameraId of [...media.keys()]) closeCamera(cameraId);
      state.cameras = [];
      state.selectedCameraId = "";
      closeModal();
      render();
      notify("Camera registry was reset.");
    });
    else if (action === "reload-app") location.reload();
    else if (action === "accept-modal") closeModal();
    else if (action === "pip") togglePictureInPicture();
    event.preventDefault();
  }

  async function onSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    if (!requireAdmin()) return;
    try {
      if (form.dataset.form === "user") {
        const values = new FormData(form);
        const username = String(values.get("username") || "").trim().toLowerCase();
        const pin = String(values.get("pin") || "");
        if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Username must be 3–32 letters, numbers, dots, underscores, or hyphens.");
        if (!/^\d{4}$/.test(pin)) throw new Error("Viewer PIN must contain exactly four digits.");
        if (state.accounts.length >= 20) throw new Error("The local account limit of 20 has been reached.");
        if (state.accounts.some((account) => account.username === username)) throw new Error("That username already exists.");
        const days = Number(values.get("subscriptionDays"));
        const dailyHours = Number(values.get("dailyHours"));
        const cameraIds = assignedCameraIdsFromForm(values);
        if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error("Subscription days must be between 0 and 3650.");
        if (!Number.isFinite(dailyHours) || dailyHours < 0 || dailyHours > 24) throw new Error("Daily viewing hours must be between 0 and 24.");
        const renewalUrl = validateWebUrl(values.get("renewalUrl"), "Renewal/payment URL");
        const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const digest = await sha256(`${salt}:${pin}`);
        const previousAccounts = state.accounts;
        state.accounts = [...state.accounts, {
          username, role: "user", salt, digest, createdAt: new Date().toISOString(),
          enabled: true, accessMessage: "Service Maintenance — viewing has been paused by the administrator.",
          subscriptionExpiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : "",
          dailyLimitMinutes: Math.round(dailyHours * 60), usageDay: localDayKey(), usedSeconds: 0, renewalUrl, cameraIds,
        }];
        try {
          persistAccounts();
        } catch (error) {
          state.accounts = previousAccounts;
          throw error;
        }
        render();
        notify(`Viewer account ${username} created.`);
      } else if (form.dataset.form === "access") {
        const values = new FormData(form);
        const username = String(values.get("username") || "");
        const account = state.accounts.find((item) => item.username === username && item.role === "user");
        if (!account) throw new Error("Viewer account no longer exists.");
        const expirationInput = String(values.get("subscriptionEndsAt") || "").trim();
        const dailyHours = Number(values.get("dailyHours"));
        if (!Number.isFinite(dailyHours) || dailyHours < 0 || dailyHours > 24) throw new Error("Daily viewing hours must be between 0 and 24.");
        const expiration = expirationInput ? new Date(expirationInput) : null;
        if (expiration && !Number.isFinite(expiration.getTime())) throw new Error("Enter a valid subscription end date and time.");
        if (expiration && expiration.getTime() > Date.now() + 3650 * 86_400_000) throw new Error("Subscription expiry cannot be more than 10 years away.");
        const renewalUrl = validateWebUrl(values.get("renewalUrl"), "Renewal/payment URL");
        const cameraIds = assignedCameraIdsFromForm(values);
        const previousAccount = { ...account };
        account.enabled = values.get("enabled") === "on";
        account.subscriptionExpiresAt = expiration ? expiration.toISOString() : "";
        account.dailyLimitMinutes = Math.round(dailyHours * 60);
        account.renewalUrl = renewalUrl;
        account.cameraIds = cameraIds;
        account.accessMessage = String(values.get("accessMessage") || "").trim().slice(0, 240)
          || "Service Maintenance — viewing has been paused by the administrator.";
        try {
          persistAccounts();
        } catch (error) {
          Object.assign(account, previousAccount);
          throw error;
        }
        render();
        notify(`Access settings saved for ${username}.`);
      } else if (form.dataset.form === "surveillance") {
        const values = new FormData(form);
        const sensitivity = Number(values.get("zoneSensitivity"));
        if (![8, 12, 18, 25, 35, 50].includes(sensitivity)) throw new Error("Select a supported motion sensitivity.");
        const previousSettings = state.settings;
        state.settings = {
          ...state.settings,
          zonesEnabled: values.get("zonesEnabled") === "on",
          zoneSensitivity: sensitivity,
          alarmToneEnabled: values.get("alarmToneEnabled") === "on",
          alarmVoiceEnabled: values.get("alarmVoiceEnabled") === "on",
          alarmWebhookUrl: validateWebUrl(values.get("alarmWebhookUrl"), "Alarm bridge URL"),
        };
        if (!saveSettings()) {
          state.settings = previousSettings;
          render();
          return;
        }
        syncZoneMonitor();
        render();
        notify("Restricted-area alarm settings saved in this browser.");
      } else if (form.dataset.form === "maintenance") {
        const values = new FormData(form);
        const message = String(values.get("maintenanceMessage") || "").trim();
        if (!message) throw new Error("Enter a service message for viewers.");
        const previousSettings = state.settings;
        state.settings = { ...state.settings };
        state.settings.maintenanceEnabled = values.get("maintenanceEnabled") === "on";
        state.settings.maintenanceMessage = message.slice(0, 240);
        if (!saveSettings()) {
          state.settings = previousSettings;
          render();
          return;
        }
        render();
        notify(state.settings.maintenanceEnabled ? "Maintenance mode enabled for local viewer accounts." : "Maintenance mode disabled.");
      } else if (form.dataset.form === "camera") {
        const camera = cameraFromForm(form);
        await dbPut("cameras", camera);
        state.cameras = [...state.cameras.filter((item) => item.id !== camera.id), camera].sort((a, b) => a.sortOrder - b.sortOrder);
        if (!state.selectedCameraId) state.selectedCameraId = camera.id;
        closeModal();
        render();
        notify("Camera saved in the local registry.");
      } else if (form.dataset.form === "gateway") await saveGatewaySettings(form);
      else if (form.dataset.form === "event") {
        const values = new FormData(form);
        const confidence = String(values.get("confidence") || "").trim();
        const category = String(values.get("category"));
        const eventRecord = await addAnalyticsEvent({
          cameraId: values.get("cameraId"), category, summary: values.get("summary"),
          severity: values.get("severity"),
          confidence: confidence ? Number(confidence) / 100 : null,
          label: values.get("label"), source: "manual-entry",
        });
        closeModal();
        speakAlert(`${eventRecord.category.replace("-", " ")} event on ${cameraById(eventRecord.cameraId)?.name || "camera"}`, eventRecord.severity);
        render();
        notify("Event saved locally.");
      }
    } catch (error) {
      notify(error.message || "The form could not be saved.", "error");
      console.error("Form submission failed:", error);
    }
  }

  function onInput(event) {
    if (event.target.id === "auth-username") {
      if (state.authStep === "setup") state.setupUsername = event.target.value;
      else state.authUsername = event.target.value;
    }
    if (event.target.matches('[data-input="analytics-search"]')) {
      state.search = event.target.value;
      const selection = event.target.selectionStart;
      const query = state.search.toLocaleLowerCase();
      const visible = state.events.filter((item) => {
        const categoryMatch = state.analyticsFilter === "all" || item.category === state.analyticsFilter;
        const camera = cameraById(item.cameraId);
        const text = `${item.summary || ""} ${item.plateText || ""} ${item.label || ""} ${camera?.name || ""}`.toLocaleLowerCase();
        return categoryMatch && (!query || text.includes(query));
      }).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 200);
      const tbody = document.querySelector("tbody");
      if (tbody) {
        tbody.innerHTML = visible.map((item) => `<tr tabindex="0" data-action="event-detail" data-event="${escapeHtml(item.id)}"><td class="mono">${formatDate(item.occurredAt)}</td><td>${escapeHtml(item.category.replace("-", " "))}</td><td>${escapeHtml(cameraById(item.cameraId)?.name || item.cameraName || "Unknown camera")}</td><td>${escapeHtml(item.plateText || item.label || item.summary || "Detection event")}</td><td>${item.confidence == null ? "—" : `${Math.round(item.confidence * 100)}%`}</td><td><span class="severity ${item.severity === "high" ? "high" : item.severity === "low" ? "low" : ""}">${escapeHtml(item.severity || "medium")}</span></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-state"><strong>No matching events</strong>Adjust filters or add an event from an integrated analytics source.</div></td></tr>`;
      }
      event.target.focus();
      if (selection != null) event.target.setSelectionRange(selection, selection);
    }
    if (event.target.id === "pin-keyboard" && event.target.value) {
      const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
      state.pinInput = digits;
      event.target.value = "";
      renderAuth();
      if (digits.length === 4) window.setTimeout(completePinEntry, 80);
    }
  }

  function onKeyDown(event) {
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (event.key === "Tab") {
      const surface = state.auth !== "unlocked"
        ? document.querySelector(".auth-card")
        : state.modal ? document.querySelector('[role="dialog"]') : null;
      if (surface) trapFocus(event, surface);
    }
    if (state.auth !== "unlocked") {
      if (target instanceof Element && target.id === "auth-username") {
        if (event.key === "ArrowDown" || event.key === "Enter") {
          document.querySelector('[data-action="pin-key"]')?.focus();
          event.preventDefault();
        }
        return;
      }
      if (/^\d$/.test(event.key)) {
        addPinDigit(event.key);
        event.preventDefault();
      } else if (event.key === "Backspace") {
        state.pinInput = state.pinInput.slice(0, -1);
        renderAuth();
        event.preventDefault();
      } else if (event.key.startsWith("Arrow")) {
        moveFocus(event.key);
        event.preventDefault();
      }
      return;
    }
    const editing = target instanceof Element && target.matches("input, textarea, select, [contenteditable=true]");
    if (event.key === "Escape" && state.zoneDrawingCameraId && !editing) {
      state.zoneDrawingCameraId = "";
      state.zoneDraft = null;
      state.zoneNameDraft = "";
      render();
      event.preventDefault();
      return;
    }
    if (target instanceof Element && target.matches(".zone-canvas")
      && (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key))) {
      handleZoneKeyboard(event, target);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" || event.key === "BrowserBack") {
      if (state.modal) closeModal();
      else if (state.view !== "grid") setView("grid");
      else if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      event.preventDefault();
      return;
    }
    if (activeCameraCard(target) && (event.key === "Enter" || event.key === " ")) {
      focusCamera(target.dataset.camera);
      event.preventDefault();
      return;
    }
    if (target instanceof Element && target.matches("tr[data-action='event-detail']") && event.key === "Enter") {
      if (requireAdmin()) openModal({ type: "event-detail", eventId: target.dataset.event });
      event.preventDefault();
      return;
    }
    if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (/^[1-9]$/.test(key)) {
      const camera = camerasVisibleToCurrentUser()[Number(key) - 1];
      if (camera) focusCamera(camera.id);
    } else if (key === "0") {
      state.settings.gridMode = "grid";
      render();
    } else if (key === "g") setView("grid");
    else if (key === "a" && isAdmin()) setView("analytics");
    else if (key === "r" && isAdmin()) setView("recordings");
    else if (key === "m") setMuted(!state.settings.muted);
    else if (key === "s" && isAdmin() && selectedCamera()) captureSnapshot(selectedCamera().id);
    else if (key === "p") togglePictureInPicture();
    else if (key === "l") lockSystem();
    else if (event.key.startsWith("Arrow")) {
      moveFocus(event.key);
      event.preventDefault();
    } else if (event.key === "Backspace") {
      if (state.modal) closeModal();
      else if (state.view !== "grid") setView("grid");
      event.preventDefault();
    }
  }

  function handleZoneKeyboard(event, canvas) {
    let draft = state.zoneDraft;
    if (draft && !draft.keyboard) return;
    let createdNow = false;
    if (!draft) {
      draft = {
        cameraId: canvas.dataset.zoneCanvas, keyboard: true, keyboardPhase: "anchor",
        startX: 0.25, startY: 0.25, endX: 0.25, endY: 0.25,
        x: 0.25, y: 0.25, width: 0.001, height: 0.001,
      };
      state.zoneDraft = draft;
      createdNow = true;
    }
    if (event.key === "Enter") {
      if (draft.keyboardPhase === "anchor") {
        if (createdNow) {
          updateKeyboardZoneRectangle(canvas, draft);
          canvas.querySelector("[data-zone-instructions]").textContent = "Use arrows to place the first corner · Enter to set the opposite corner";
        } else {
          draft.keyboardPhase = "extent";
          draft.endX = draft.startX;
          draft.endY = draft.startY;
          canvas.querySelector("[data-zone-instructions]").textContent = "Use arrows to set the opposite corner · Enter saves · Esc cancels";
        }
        return;
      }
      state.zoneDraft = null;
      saveRestrictedZone(cameraById(draft.cameraId), draft);
      return;
    }
    const anchor = draft.keyboardPhase === "anchor";
    let x = anchor ? draft.startX : draft.endX;
    let y = anchor ? draft.startY : draft.endY;
    if (event.key === "ArrowLeft") x -= 0.025;
    if (event.key === "ArrowRight") x += 0.025;
    if (event.key === "ArrowUp") y -= 0.025;
    if (event.key === "ArrowDown") y += 0.025;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    if (anchor) {
      draft.startX = x;
      draft.startY = y;
    } else {
      draft.endX = x;
      draft.endY = y;
    }
    draft.x = Math.min(draft.startX, draft.endX);
    draft.y = Math.min(draft.startY, draft.endY);
    draft.width = Math.max(0.001, Math.abs(draft.endX - draft.startX));
    draft.height = Math.max(0.001, Math.abs(draft.endY - draft.startY));
    updateKeyboardZoneRectangle(canvas, draft);
    canvas.querySelector("[data-zone-instructions]").textContent = anchor
      ? "Use arrows to place the first corner · Enter to set the opposite corner"
      : "Use arrows to set the opposite corner · Enter saves · Esc cancels";
  }

  function updateKeyboardZoneRectangle(canvas, draft) {
    const rect = canvas.querySelector(".zone-draft");
    if (!rect) return;
    rect.classList.add("active");
    rect.style.left = `${draft.x * 100}%`;
    rect.style.top = `${draft.y * 100}%`;
    rect.style.width = `${draft.width * 100}%`;
    rect.style.height = `${draft.height * 100}%`;
  }

  function trapFocus(event, surface) {
    const focusable = [...surface.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")]
      .filter((element) => element.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      surface.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }

  function moveFocus(key) {
    const active = document.activeElement;
    const scope = state.auth !== "unlocked"
      ? document.querySelector(".auth-card")
      : state.modal ? document.querySelector(".modal") : document;
    if (!scope) return;
    const candidates = [...scope.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex='0']")]
      .filter((element) => element.getClientRects().length);
    if (!candidates.length) return;
    const current = candidates.indexOf(active);
    if (current < 0) {
      candidates[0].focus();
      return;
    }
    if (active.matches(".camera-card")) {
      const cards = [...document.querySelectorAll(".camera-card")];
      const index = cards.indexOf(active);
      const columns = getComputedStyle(document.querySelector(".camera-grid")).gridTemplateColumns.split(" ").length;
      let next = index;
      if (key === "ArrowRight") next = Math.min(cards.length - 1, index + 1);
      if (key === "ArrowLeft") next = Math.max(0, index - 1);
      if (key === "ArrowDown") next = Math.min(cards.length - 1, index + columns);
      if (key === "ArrowUp") next = Math.max(0, index - columns);
      if (cards[next] && next !== index) cards[next].focus();
      return;
    }
    const rect = active.getBoundingClientRect();
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    const ranked = candidates.filter((item) => item !== active).map((item) => {
      const other = item.getBoundingClientRect();
      const primary = horizontal ? other.left + other.width / 2 - rect.left - rect.width / 2 : other.top + other.height / 2 - rect.top - rect.height / 2;
      const cross = horizontal ? other.top + other.height / 2 - rect.top - rect.height / 2 : other.left + other.width / 2 - rect.left - rect.width / 2;
      return { item, primary, score: Math.abs(primary) + Math.abs(cross) * 2.2 };
    }).filter((candidate) => candidate.primary * direction > 0).sort((a, b) => a.score - b.score);
    ranked[0]?.item.focus();
  }

  function onActivity(event) {
    if (event.type === "pointerdown" || event.type === "keydown" || event.type === "touchstart") {
      recordActivity();
      if (state.settings.zonesEnabled && state.settings.alarmToneEnabled) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioContext ||= new AudioContextClass();
            if (audioContext.state === "suspended") audioContext.resume().catch((error) => console.warn("Alarm audio remains blocked:", error));
          }
        } catch (error) {
          console.warn("Alarm audio initialization failed:", error);
        }
      }
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      updateViewerUsage();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      if (state.recording) stopRecording("page-hidden");
      for (const cameraId of [...media.keys()]) closeCamera(cameraId);
      syncZoneMonitor();
    } else if (state.view === "grid" && state.auth === "unlocked") {
      refreshViewerAccess();
      syncGridStreams();
    }
  }

  let streamSyncFrame = 0;
  function scheduleStreamSync() {
    if (streamSyncFrame) return;
    streamSyncFrame = requestAnimationFrame(() => {
      streamSyncFrame = 0;
      syncGridStreams();
    });
  }

  function registerOfflineShell() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext || !["http:", "https:"].includes(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Offline shell could not be registered:", error);
      notify("Offline shell caching is unavailable in this browser.", "warning");
    });
  }

  async function bootstrap() {
    try {
      db = await openDatabase();
      await seedCameras();
      await refreshData();
      await pruneExpiredData(false);
      await pruneAnalyticsCache();
      const authRecord = readAuthRecord();
      state.accounts = authRecord?.accounts || [];
      loadAccessLog();
      state.auth = authRecord ? "locked" : "setup";
      state.authStep = authRecord ? "unlock" : "setup";
      state.mute = state.settings.muted;
      if (!state.selectedCameraId) state.selectedCameraId = state.cameras.find((camera) => camera.enabled)?.id || "";
      render();
      registerOfflineShell();
      scheduleAnalyticsPoll();
    } catch (error) {
      console.error("Sentinel startup failed:", error);
      root.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="brand-mark">!</div><h1>Startup unavailable</h1><p>${escapeHtml(error.message)}<br><br>Check browser storage and local account data, then reload Sentinel. If local account data is corrupted, the trusted browser profile owner must clear the app's local account storage.</p><button class="btn primary" data-action="reload-app">Retry</button></section></main>`;
    }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keydown", onActivity);
  document.addEventListener("pointerdown", onActivity, { passive: true });
  document.addEventListener("touchstart", onActivity, { passive: true });
  document.addEventListener("pointerdown", onZonePointerDown);
  document.addEventListener("pointermove", onZonePointerMove);
  document.addEventListener("pointerup", onZonePointerUp);
  document.addEventListener("pointercancel", onZonePointerCancel);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", () => {
    notify("Network restored. Reconnecting eligible camera streams.");
    if (state.view === "grid") {
      for (const cameraId of [...media.keys()]) closeCamera(cameraId);
      syncGridStreams();
    }
    if (state.settings.analyticsUrl && state.auth === "unlocked" && isAdmin()) syncAnalytics();
  });
  window.addEventListener("offline", () => notify("Network unavailable. Cached data remains available; live streams may stop.", "warning"));
  window.addEventListener("scroll", scheduleStreamSync, { passive: true });
  window.addEventListener("resize", scheduleStreamSync, { passive: true });
  bootstrap();
})();
