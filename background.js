const tabStats = {};
const HISTORY_LENGTH = 30;

function ensureTab(tabId) {
    if (!tabStats[tabId]) {
        tabStats[tabId] = {
            totalBytes: 0,
            requests: 0,
            bytesThisSecond: 0,
            speedBps: 0,
            history: Array(HISTORY_LENGTH).fill(0)
        };
    }

    return tabStats[tabId];
}

function addBytes(tabId, bytes) {
    if (tabId < 0 || !bytes) return;

    const stats = ensureTab(tabId);
    stats.totalBytes += bytes;
    stats.bytesThisSecond += bytes;
}

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.tabId < 0) return;

        const stats = ensureTab(details.tabId);
        stats.requests++;

        try {
            const filter = browser.webRequest.filterResponseData(details.requestId);

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
        } catch (error) {
            // Some requests cannot be filtered.
        }
    },
    { urls: ["http://*/*", "https://*/*"] },
    ["blocking"]
);

setInterval(() => {
    for (const tabId of Object.keys(tabStats)) {
        const stats = tabStats[tabId];

        stats.speedBps = stats.bytesThisSecond;
        stats.bytesThisSecond = 0;

        stats.history.push(stats.speedBps);

        if (stats.history.length > HISTORY_LENGTH) {
            stats.history.shift();
        }
    }
}, 1000);

browser.tabs.onRemoved.addListener((tabId) => {
    delete tabStats[tabId];
});

browser.runtime.onMessage.addListener((message) => {
    if (message.type === "GET_TAB_STATS") {
        return Promise.resolve(tabStats);
    }
});
