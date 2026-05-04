function formatBytes(bytes) {
    if (!bytes) return "0 B";

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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
    return stats[String(tabId)] || {
        totalBytes: 0,
        requests: 0,
        speedBps: 0,
        history: Array(30).fill(0)
    };
}

function createGraph(history) {
    const points = history && history.length > 0 ? history : Array(30).fill(0);
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

    const svgNamespace = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(svgNamespace, "svg");
    svg.classList.add("network-graph");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const baseline = document.createElementNS(svgNamespace, "line");
    baseline.classList.add("graph-baseline");
    baseline.setAttribute("x1", "0");
    baseline.setAttribute("y1", String(height - 1));
    baseline.setAttribute("x2", String(width));
    baseline.setAttribute("y2", String(height - 1));

    const line = document.createElementNS(svgNamespace, "polyline");
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

function createTabRow(tab, tabStat) {
    const row = document.createElement("div");
    row.className = "tab-row";

    if (tabStat.speedBps > 0) {
        row.classList.add("active");
    }

    const title = tab.title || "Untitled tab";
    const url = tab.url || "";

    row.setAttribute("data-tooltip-title", title);
    row.setAttribute("data-tooltip-url", url);

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

    row.append(createTabIcon(tab), tabContent);
    return row;
}

async function updatePopup() {
    const tabs = await browser.tabs.query({});
    const stats = await browser.runtime.sendMessage({ type: "GET_TAB_STATS" });

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
        if (b.tabStat.speedBps !== a.tabStat.speedBps) {
            return b.tabStat.speedBps - a.tabStat.speedBps;
        }

        return b.tabStat.totalBytes - a.tabStat.totalBytes;
    });

    const rows = sortedTabs.map((item) => createTabRow(item.tab, item.tabStat));
    container.replaceChildren(...rows);
    summary.textContent = formatSpeed(totalSpeed);
}

updatePopup();
setInterval(updatePopup, 1000);
