# Tab Network Monitor

Tab Network Monitor displays estimated live network activity for open browser tabs.

## Browser packages

The source uses shared popup and background code with browser-specific manifests:

- `manifest.json` is the Chrome Manifest V3 package manifest.
- `manifest.firefox.json` is the Firefox Manifest V3 package manifest.

Build both upload zips with:

```sh
./build.sh
```

The build outputs are:

- `dist/tab-network-monitor-chrome.zip`
- `dist/tab-network-monitor-firefox.zip`

Chrome MV3 does not expose Firefox's response body stream API. In Chrome, the extension estimates transferred bytes from `Content-Length` response headers when they are available. In Firefox, it uses `webRequest.filterResponseData()` for live response-byte counting and falls back to header estimates for requests that cannot be filtered.
