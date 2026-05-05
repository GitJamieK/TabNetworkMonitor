const HISTORY_LENGTH = 30;
const REQUEST_FILTER = { urls: ["http://*/*", "https://*/*"] };
const api = globalThis.browser || globalThis.chrome;
const tabStats = {};
const headerEstimateRequestIds = new Set();
const canFilterResponseData = Boolean(api.webRequest.filterResponseData);

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

function getContentLength(responseHeaders) {
    const header = responseHeaders?.find((item) => {
        return item.name && item.name.toLowerCase() === "content-length";
    });

    if (!header) return 0;

    const bytes = Number.parseInt(header.value, 10);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function trackResponseStream(details) {
    try {
        const filter = api.webRequest.filterResponseData(details.requestId);

        filter.ondata = (event) => {
            addBytes(details.tabId, event.data.byteLength);
            filter.write(event.data);
        };

        filter.onstop = () => {
            filter.close();
        };

        filter.onerror = () => {
            try {
                filter.disconnect();
            } catch (error) {
                // Ignore cleanup errors.
            }
        };

        return true;
    } catch (error) {
        return false;
    }
}

function handleBeforeRequest(details) {
    if (details.tabId < 0) return;

    const stats = ensureTab(details.tabId);
    stats.requests++;

    if (canFilterResponseData && trackResponseStream(details)) {
        return;
    }

    headerEstimateRequestIds.add(details.requestId);
}

function handleHeadersReceived(details) {
    if (details.tabId < 0 || !headerEstimateRequestIds.has(details.requestId)) {
        return;
    }

    addBytes(details.tabId, getContentLength(details.responseHeaders));
}

function forgetRequest(details) {
    headerEstimateRequestIds.delete(details.requestId);
}

api.webRequest.onBeforeRequest.addListener(
    handleBeforeRequest,
    REQUEST_FILTER,
    canFilterResponseData ? ["blocking"] : []
);

api.webRequest.onHeadersReceived.addListener(
    handleHeadersReceived,
    REQUEST_FILTER,
    ["responseHeaders"]
);

api.webRequest.onCompleted.addListener(forgetRequest, REQUEST_FILTER);
api.webRequest.onErrorOccurred.addListener(forgetRequest, REQUEST_FILTER);

api.tabs.onRemoved.addListener((tabId) => {
    delete tabStats[tabId];
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_TAB_STATS") {
        sendResponse(getStatsSnapshot());
    }
});
