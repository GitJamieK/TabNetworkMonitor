const api = globalThis.browser || globalThis.chrome;
const HISTORY_LENGTH = 30;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const POPUP_MIN_HEIGHT = 260;
const POPUP_HEIGHT_STORAGE_KEY = "popupHeight";
const NETWORK_ORIGINS = ["http://*/*", "https://*/*"];
const usesPromiseApi = Boolean(globalThis.browser);
const isDetachedWindow = new URLSearchParams(window.location.search).get("detached") === "1";
let pinnedTabIds = new Set();
let resizeState = null;

function queryTabs(queryInfo) {
    if (usesPromiseApi) {
        return api.tabs.query(queryInfo);
    }

    return new Promise((resolve, reject) => {
        api.tabs.query(queryInfo, (tabs) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(tabs);
        });
    });
}

function sendRuntimeMessage(message) {
    const validateResponse = (response) => {
        if (response?.error) {
            throw new Error(response.error);
        }

        return response;
    };

    if (usesPromiseApi) {
        return api.runtime.sendMessage(message).then(validateResponse);
    }

    return new Promise((resolve, reject) => {
        api.runtime.sendMessage(message, (response) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            try {
                resolve(validateResponse(response));
            } catch (responseError) {
                reject(responseError);
            }
        });
    });
}

function getCurrentWindow() {
    if (usesPromiseApi) {
        return api.windows.getCurrent();
    }

    return new Promise((resolve, reject) => {
        api.windows.getCurrent((currentWindow) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(currentWindow);
        });
    });
}

function updateBrowserWindow(windowId, updateInfo) {
    if (usesPromiseApi) {
        return api.windows.update(windowId, updateInfo);
    }

    return new Promise((resolve, reject) => {
        api.windows.update(windowId, updateInfo, (updatedWindow) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(updatedWindow);
        });
    });
}

function containsNetworkAccess() {
    if (usesPromiseApi || !api.permissions?.contains) {
        return Promise.resolve(true);
    }

    const permissions = { origins: NETWORK_ORIGINS };

    if (usesPromiseApi) {
        return api.permissions.contains(permissions);
    }

    return new Promise((resolve, reject) => {
        api.permissions.contains(permissions, (hasAccess) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(hasAccess);
        });
    });
}

function requestNetworkAccess() {
    if (usesPromiseApi || !api.permissions?.request) {
        return Promise.resolve(true);
    }

    const permissions = { origins: NETWORK_ORIGINS };

    if (usesPromiseApi) {
        return api.permissions.request(permissions);
    }

    return new Promise((resolve, reject) => {
        api.permissions.request(permissions, (granted) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(granted);
        });
    });
}

function createPinIcon() {
    const icon = document.createElement("span");
    icon.className = "pin-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📌";
    return icon;
}

function getPinnedOrder() {
    const pinnedOrder = new Map();
    Array.from(pinnedTabIds).forEach((tabId, index) => {
        pinnedOrder.set(tabId, index);
    });

    return pinnedOrder;
}

function isTabPinned(tabId) {
    return pinnedTabIds.has(String(tabId));
}

function applyWindowPinState(button) {
    button.classList.toggle("pinned", isDetachedWindow);
    button.setAttribute(
        "aria-label",
        isDetachedWindow ? "Close pinned monitor window" : "Open pinned monitor window"
    );
    button.title = isDetachedWindow ? "Close pinned monitor window" : "Open pinned monitor window";
}

async function handleWindowPinClick(button) {
    button.disabled = true;

    try {
        if (isDetachedWindow) {
            sendRuntimeMessage({ type: "CLOSE_DETACHED_POPUP" }).catch(() => {
                window.close();
            });
            window.close();
            return;
        }

        await sendRuntimeMessage({
            type: "OPEN_DETACHED_POPUP"
        });
        button.classList.add("pinned");
    } finally {
        button.disabled = false;
    }
}

function setupWindowPinButton() {
    const button = document.getElementById("window-pin");
    if (!button) return;

    button.replaceChildren(createPinIcon());
    applyWindowPinState(button);
    button.addEventListener("click", () => handleWindowPinClick(button));
}

async function refreshAccessPanel() {
    const panel = document.getElementById("access-panel");
    if (!panel) return;

    const hasAccess = await containsNetworkAccess();
    panel.hidden = hasAccess;
}

function setupAccessPanel() {
    const panel = document.getElementById("access-panel");
    const button = document.getElementById("access-button");

    if (!panel || !button) return;

    refreshAccessPanel().catch(() => {
        panel.hidden = true;
    });

    button.addEventListener("click", async () => {
        button.disabled = true;

        try {
            const granted = await requestNetworkAccess();
            panel.hidden = granted;

            if (granted) {
                await updatePopup();
            }
        } finally {
            button.disabled = false;
        }
    });
}

function clampPopupHeight(height) {
    const maxHeight = window.screen?.availHeight
        ? window.screen.availHeight - window.screenY - 8
        : Number.POSITIVE_INFINITY;

    return Math.max(POPUP_MIN_HEIGHT, Math.min(Math.round(height), maxHeight));
}

function applyDocumentPopupHeight(height) {
    const normalizedHeight = clampPopupHeight(height);
    document.body.style.height = `${normalizedHeight}px`;
    document.body.style.maxHeight = "none";
    localStorage.setItem(POPUP_HEIGHT_STORAGE_KEY, String(normalizedHeight));
}

async function updateDetachedWindowHeight(height) {
    if (!resizeState?.windowId) return;

    await updateBrowserWindow(resizeState.windowId, {
        height: clampPopupHeight(height)
    });
}

function updatePopupHeight(height) {
    if (resizeState?.mode === "detached") {
        updateDetachedWindowHeight(height).catch(() => {
            // Ignore transient resize errors while dragging.
        });
        return;
    }

    applyDocumentPopupHeight(height);
}

function schedulePopupResize(height) {
    if (!resizeState) return;

    resizeState.height = clampPopupHeight(height);

    if (resizeState.frameRequested) return;

    resizeState.frameRequested = true;

    requestAnimationFrame(() => {
        if (!resizeState) return;

        resizeState.frameRequested = false;
        updatePopupHeight(resizeState.height);
    });
}

function finishPopupResize(handle) {
    if (!resizeState) return;

    const height = resizeState.height;
    const mode = resizeState.mode;

    try {
        handle.releasePointerCapture(resizeState.pointerId);
    } catch (error) {
        // Ignore pointer capture cleanup errors.
    }

    resizeState = null;

    if (height && mode === "detached") {
        sendRuntimeMessage({
            type: "SET_DETACHED_POPUP_HEIGHT",
            height
        }).catch(() => {
            // Ignore persistence errors after the visual resize is complete.
        });
    }
}

function getInitialResizeHeight() {
    if (isDetachedWindow) {
        return window.outerHeight;
    }

    return document.body.getBoundingClientRect().height;
}

async function createResizeState(event) {
    const state = {
        mode: isDetachedWindow ? "detached" : "document",
        pointerId: event.pointerId,
        startY: event.screenY,
        startHeight: getInitialResizeHeight(),
        height: getInitialResizeHeight(),
        windowId: null,
        frameRequested: false
    };

    if (isDetachedWindow) {
        const currentWindow = await getCurrentWindow();
        state.windowId = currentWindow.id;
    }

    return state;
}

function setupResizeHandle() {
    const handle = document.getElementById("resize-handle");
    if (!handle) return;

    handle.hidden = false;

    handle.addEventListener("pointerdown", async (event) => {
        event.preventDefault();
        resizeState = await createResizeState(event);
        handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;

        const deltaY = event.screenY - resizeState.startY;
        schedulePopupResize(resizeState.startHeight + deltaY);
    });

    handle.addEventListener("pointerup", () => finishPopupResize(handle));
    handle.addEventListener("pointercancel", () => finishPopupResize(handle));
}

function restoreDocumentPopupHeight() {
    if (isDetachedWindow) return;

    const storedHeight = Number.parseInt(localStorage.getItem(POPUP_HEIGHT_STORAGE_KEY), 10);

    if (Number.isFinite(storedHeight)) {
        applyDocumentPopupHeight(storedHeight);
    }
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;

    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond) return "0 B/s";

    if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;

    return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
}

function getFallbackIcon(tab) {
    if (tab.url?.startsWith("file:") && tab.url.toLowerCase().endsWith(".pdf")) {
        return "📄";
    }

    if (tab.url?.startsWith("about:")) {
        return "🧩";
    }

    return "🌐";
}

function getTabStats(stats, tabId) {
    return stats?.[String(tabId)] || {
        totalBytes: 0,
        requests: 0,
        speedBps: 0,
        history: Array(HISTORY_LENGTH).fill(0)
    };
}

function createGraph(history) {
    const points = history && history.length > 0 ? history : Array(HISTORY_LENGTH).fill(0);
    const maxValue = Math.max(...points, 1);

    const width = 150;
    const height = 28;
    const step = points.length > 1 ? width / (points.length - 1) : width;

    const graphPoints = points
    .map((value, index) => {
        const x = index * step;
        const y = height - (value / maxValue) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.classList.add("network-graph");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const baseline = document.createElementNS(SVG_NAMESPACE, "line");
    baseline.classList.add("graph-baseline");
    baseline.setAttribute("x1", "0");
    baseline.setAttribute("y1", String(height - 1));
    baseline.setAttribute("x2", String(width));
    baseline.setAttribute("y2", String(height - 1));

    const line = document.createElementNS(SVG_NAMESPACE, "polyline");
    line.classList.add("graph-line");
    line.setAttribute("points", graphPoints);

    svg.append(baseline, line);
    return svg;
}

function createTabIcon(tab) {
    if (tab.favIconUrl) {
        const image = document.createElement("img");
        image.className = "tab-icon";
        image.src = tab.favIconUrl;
        image.alt = "";
        return image;
    }

    const fallbackIcon = document.createElement("div");
    fallbackIcon.className = "tab-icon fallback-icon";
    fallbackIcon.textContent = getFallbackIcon(tab);
    return fallbackIcon;
}

function createTextElement(className, text) {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return element;
}

function createUsageText(tabStat) {
    const usage = document.createElement("div");
    usage.className = "usage";

    const speed = document.createElement("span");
    speed.textContent = formatSpeed(tabStat.speedBps);

    const total = document.createElement("span");
    total.textContent = formatBytes(tabStat.totalBytes);

    const requests = document.createElement("span");
    requests.textContent = `${tabStat.requests} requests`;

    usage.append(speed, total, requests);
    return usage;
}

function createTabPinButton(tab) {
    const pinned = isTabPinned(tab.id);
    const button = document.createElement("button");
    button.className = "pin-button tab-pin-button";
    button.type = "button";
    button.classList.toggle("pinned", pinned);
    button.setAttribute("aria-label", pinned ? "Unpin tab from top" : "Pin tab to top");
    button.title = pinned ? "Unpin tab from top" : "Pin tab to top";
    button.append(createPinIcon());

    button.addEventListener("click", async (event) => {
        event.stopPropagation();
        button.disabled = true;

        try {
            const response = await sendRuntimeMessage({
                type: "TOGGLE_TAB_PIN",
                tabId: tab.id
            });

            pinnedTabIds = new Set((response?.pinnedTabIds || []).map(String));
            await updatePopup();
        } finally {
            button.disabled = false;
        }
    });

    return button;
}

function createTabRow(tab, tabStat) {
    const row = document.createElement("div");
    row.className = "tab-row";

    if (tabStat.speedBps > 0) {
        row.classList.add("active");
    }

    if (isTabPinned(tab.id)) {
        row.classList.add("pinned");
    }

    const title = tab.title || "Untitled tab";
    const url = tab.url || "";

    const tabContent = document.createElement("div");
    tabContent.className = "tab-content";

    const usageRow = document.createElement("div");
    usageRow.className = "usage-row";
    usageRow.append(createUsageText(tabStat), createGraph(tabStat.history));

    tabContent.append(
        createTextElement("title", title),
        createTextElement("url", url),
        usageRow
    );

    row.append(createTabIcon(tab), tabContent, createTabPinButton(tab));
    return row;
}

async function updatePopup() {
    const tabs = await queryTabs({});
    const popupState = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    const stats = popupState?.stats || {};
    pinnedTabIds = new Set((popupState?.pinnedTabIds || []).map(String));
    const pinnedOrder = getPinnedOrder();

    const container = document.getElementById("tabs");
    const summary = document.getElementById("summary");

    let totalSpeed = 0;

    const sortedTabs = tabs
    .map((tab) => {
        const tabStat = getTabStats(stats, tab.id);
        totalSpeed += tabStat.speedBps;

        return {
            tab,
            tabStat
        };
    })
    .sort((a, b) => {
        const aPinnedIndex = pinnedOrder.get(String(a.tab.id));
        const bPinnedIndex = pinnedOrder.get(String(b.tab.id));
        const aPinned = aPinnedIndex !== undefined;
        const bPinned = bPinnedIndex !== undefined;

        if (aPinned !== bPinned) {
            return aPinned ? -1 : 1;
        }

        if (aPinned && bPinned && aPinnedIndex !== bPinnedIndex) {
            return aPinnedIndex - bPinnedIndex;
        }

        if (b.tabStat.speedBps !== a.tabStat.speedBps) {
            return b.tabStat.speedBps - a.tabStat.speedBps;
        }

        return b.tabStat.totalBytes - a.tabStat.totalBytes;
    });

    const rows = sortedTabs.map((item) => createTabRow(item.tab, item.tabStat));
    container.replaceChildren(...rows);
    summary.textContent = formatSpeed(totalSpeed);
}

document.body.classList.toggle("detached-window", isDetachedWindow);
restoreDocumentPopupHeight();
setupAccessPanel();
setupWindowPinButton();
setupResizeHandle();
updatePopup();
setInterval(updatePopup, 1000);
