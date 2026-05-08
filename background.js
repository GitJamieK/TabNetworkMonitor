const HISTORY_LENGTH = 30;
const REQUEST_FILTER = { urls: ["http://*/*", "https://*/*"] };
const api = globalThis.browser || globalThis.chrome;
const usesPromiseApi = Boolean(globalThis.browser);
const tabStats = {};
const PINNED_TABS_STORAGE_KEY = "pinnedTabIds";
const DETACHED_HEIGHT_STORAGE_KEY = "detachedPopupHeight";
const DETACHED_POPUP_URL = api.runtime.getURL("popup.html?detached=1");
const DETACHED_POPUP_MIN_HEIGHT = 260;
const DETACHED_POPUP_DEFAULT_HEIGHT = 620;
let pinnedTabIds = [];
let pinnedTabsReady = loadPinnedTabs();
let detachedWindowId = null;

function getStorage(keys) {
    if (usesPromiseApi) {
        return api.storage.local.get(keys);
    }

    return new Promise((resolve, reject) => {
        api.storage.local.get(keys, (result) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(result);
        });
    });
}

function setStorage(items) {
    if (usesPromiseApi) {
        return api.storage.local.set(items);
    }

    return new Promise((resolve, reject) => {
        api.storage.local.set(items, () => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

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

function createWindow(createData) {
    if (usesPromiseApi) {
        return api.windows.create(createData);
    }

    return new Promise((resolve, reject) => {
        api.windows.create(createData, (createdWindow) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(createdWindow);
        });
    });
}

function getAllWindows(queryInfo) {
    if (usesPromiseApi) {
        return api.windows.getAll(queryInfo);
    }

    return new Promise((resolve, reject) => {
        api.windows.getAll(queryInfo, (windows) => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve(windows);
        });
    });
}

function updateWindow(windowId, updateInfo) {
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

function removeWindow(windowId) {
    if (usesPromiseApi) {
        return api.windows.remove(windowId);
    }

    return new Promise((resolve, reject) => {
        api.windows.remove(windowId, () => {
            const error = api.runtime.lastError;

            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

async function savePinnedTabs() {
    await setStorage({ [PINNED_TABS_STORAGE_KEY]: pinnedTabIds });
}

async function prunePinnedTabsToOpenTabs() {
    const tabs = await queryTabs({});
    const openTabIds = new Set(tabs.map((tab) => String(tab.id)));
    const nextPinnedTabIds = pinnedTabIds.filter((tabId) => openTabIds.has(tabId));

    if (nextPinnedTabIds.length !== pinnedTabIds.length) {
        pinnedTabIds = nextPinnedTabIds;
        await savePinnedTabs();
    }
}

async function loadPinnedTabs() {
    const result = await getStorage({ [PINNED_TABS_STORAGE_KEY]: [] });
    const storedTabIds = Array.isArray(result[PINNED_TABS_STORAGE_KEY])
        ? result[PINNED_TABS_STORAGE_KEY]
        : [];

    pinnedTabIds = [...new Set(storedTabIds.map(String))];
    await prunePinnedTabsToOpenTabs();
}

function normalizeHeight(height) {
    const value = Number.parseInt(height, 10);

    if (!Number.isFinite(value)) {
        return DETACHED_POPUP_DEFAULT_HEIGHT;
    }

    return Math.max(DETACHED_POPUP_MIN_HEIGHT, value);
}

async function getDetachedHeight(defaultHeight) {
    const result = await getStorage({
        [DETACHED_HEIGHT_STORAGE_KEY]: defaultHeight || DETACHED_POPUP_DEFAULT_HEIGHT
    });

    return normalizeHeight(result[DETACHED_HEIGHT_STORAGE_KEY]);
}

async function saveDetachedHeight(height) {
    await setStorage({ [DETACHED_HEIGHT_STORAGE_KEY]: normalizeHeight(height) });
}

function getCurrentSecond() {
    return Math.floor(Date.now() / 1000);
}

function ensureTab(tabId) {
    if (!tabStats[tabId]) {
        tabStats[tabId] = {
            totalBytes: 0,
            requests: 0,
            history: Array(HISTORY_LENGTH).fill(0),
            lastHistorySecond: getCurrentSecond()
        };
    }

    return tabStats[tabId];
}

function advanceHistory(stats) {
    const currentSecond = getCurrentSecond();
    const elapsedSeconds = currentSecond - stats.lastHistorySecond;

    if (elapsedSeconds <= 0) return;

    if (elapsedSeconds >= HISTORY_LENGTH) {
        stats.history = Array(HISTORY_LENGTH).fill(0);
    } else {
        for (let index = 0; index < elapsedSeconds; index++) {
            stats.history.push(0);
        }

        stats.history = stats.history.slice(-HISTORY_LENGTH);
    }

    stats.lastHistorySecond = currentSecond;
}

function addBytes(tabId, bytes) {
    if (tabId < 0 || !bytes) return;

    const stats = ensureTab(tabId);
    advanceHistory(stats);
    stats.totalBytes += bytes;
    stats.history[stats.history.length - 1] += bytes;
}

function getStatsSnapshot() {
    const snapshot = {};

    for (const tabId of Object.keys(tabStats)) {
        const stats = tabStats[tabId];
        advanceHistory(stats);

        snapshot[tabId] = {
            totalBytes: stats.totalBytes,
            requests: stats.requests,
            speedBps: stats.history[stats.history.length - 1],
            history: stats.history.slice()
        };
    }

    return snapshot;
}

function getPopupState() {
    return {
        stats: getStatsSnapshot(),
        pinnedTabIds: pinnedTabIds.slice()
    };
}

async function togglePinnedTab(tabId) {
    const normalizedTabId = String(tabId);
    const existingIndex = pinnedTabIds.indexOf(normalizedTabId);
    let pinned = false;

    if (existingIndex >= 0) {
        pinnedTabIds.splice(existingIndex, 1);
    } else {
        pinnedTabIds.unshift(normalizedTabId);
        pinned = true;
    }

    await savePinnedTabs();

    return {
        pinned,
        pinnedTabIds: pinnedTabIds.slice()
    };
}

async function removePinnedTab(tabId) {
    const normalizedTabId = String(tabId);
    const nextPinnedTabIds = pinnedTabIds.filter((pinnedTabId) => {
        return pinnedTabId !== normalizedTabId;
    });

    if (nextPinnedTabIds.length === pinnedTabIds.length) return;

    pinnedTabIds = nextPinnedTabIds;
    await savePinnedTabs();
}

async function getDetachedPopupWindow() {
    const windows = await getAllWindows({
        populate: true
    });

    return windows.find((item) => {
        return item.tabs?.some((tab) => tab.url === DETACHED_POPUP_URL);
    });
}

async function openDetachedPopupWindow() {
    const existingWindow = await getDetachedPopupWindow();
    const height = await getDetachedHeight(DETACHED_POPUP_DEFAULT_HEIGHT);

    if (existingWindow?.id !== undefined) {
        detachedWindowId = existingWindow.id;
        await updateWindow(existingWindow.id, {
            height,
            focused: true
        });
        return { opened: true, reused: true };
    }

    const createdWindow = await createWindow({
        url: DETACHED_POPUP_URL,
        type: "popup",
        width: 440,
        height,
        focused: true
    });

    detachedWindowId = createdWindow?.id ?? null;
    return { opened: true, reused: false };
}

async function closeDetachedPopupWindow() {
    const existingWindow = await getDetachedPopupWindow();

    if (existingWindow?.id === undefined) {
        return { closed: false };
    }

    await removeWindow(existingWindow.id);
    detachedWindowId = null;
    return { closed: true };
}

async function setDetachedPopupHeight(height) {
    const normalizedHeight = normalizeHeight(height);
    await saveDetachedHeight(normalizedHeight);

    if (detachedWindowId !== null) {
        await updateWindow(detachedWindowId, { height: normalizedHeight });
    }

    return { height: normalizedHeight };
}

function getContentLength(responseHeaders) {
    const header = responseHeaders?.find((item) => {
        return item.name && item.name.toLowerCase() === "content-length";
    });

    if (!header) return 0;

    const bytes = Number.parseInt(header.value, 10);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function handleBeforeRequest(details) {
    if (details.tabId < 0) return;

    const stats = ensureTab(details.tabId);
    stats.requests++;
}

function handleHeadersReceived(details) {
    if (details.tabId < 0) return;

    addBytes(details.tabId, getContentLength(details.responseHeaders));
}

api.webRequest.onBeforeRequest.addListener(
    handleBeforeRequest,
    REQUEST_FILTER,
    []
);

api.webRequest.onHeadersReceived.addListener(
    handleHeadersReceived,
    REQUEST_FILTER,
    ["responseHeaders"]
);

api.tabs.onRemoved.addListener((tabId) => {
    delete tabStats[tabId];
    pinnedTabsReady = pinnedTabsReady.then(() => removePinnedTab(tabId));
});

api.windows.onRemoved?.addListener((windowId) => {
    if (windowId === detachedWindowId) {
        detachedWindowId = null;
    }
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_TAB_STATS") {
        sendResponse(getStatsSnapshot());
        return undefined;
    }

    if (message?.type === "GET_POPUP_STATE") {
        pinnedTabsReady
        .then(() => {
            sendResponse(getPopupState());
        })
        .catch((error) => {
            sendResponse({ error: error.message });
        });
        return true;
    }

    if (message?.type === "TOGGLE_TAB_PIN") {
        pinnedTabsReady
        .then(() => togglePinnedTab(message.tabId))
        .then(sendResponse)
        .catch((error) => {
            sendResponse({ error: error.message });
        });
        return true;
    }

    if (message?.type === "OPEN_DETACHED_POPUP") {
        openDetachedPopupWindow()
        .then(sendResponse)
        .catch((error) => {
            sendResponse({ error: error.message });
        });
        return true;
    }

    if (message?.type === "CLOSE_DETACHED_POPUP") {
        closeDetachedPopupWindow()
        .then(sendResponse)
        .catch((error) => {
            sendResponse({ error: error.message });
        });
        return true;
    }

    if (message?.type === "SET_DETACHED_POPUP_HEIGHT") {
        setDetachedPopupHeight(message.height)
        .then(sendResponse)
        .catch((error) => {
            sendResponse({ error: error.message });
        });
        return true;
    }

    return undefined;
});
