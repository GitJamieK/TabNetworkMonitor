# Tab Network Monitor

Tab Network Monitor displays estimated live network activity for open browser tabs.

## Browser packages

The source uses shared popup and background code with browser-specific manifests:

- `manifest.json` is the Chrome Manifest V3 package manifest. Chrome requests all-site monitoring access as an optional runtime permission to avoid required broad host permissions in the Web Store package.
- `manifest.firefox.json` is the Firefox Manifest V3 package manifest.

Build both upload zips with:

```sh
./build.sh
```

The build outputs are:

- `dist/tab-network-monitor-chrome.zip`
- `dist/tab-network-monitor-firefox.zip`

Chrome MV3 does not expose Firefox's response body stream API. In Chrome, the extension estimates transferred bytes from `Content-Length` response headers when they are available. In Firefox, it uses `webRequest.filterResponseData()` for live response-byte counting and falls back to header estimates for requests that cannot be filtered.

The toolbar popup still follows browser popup behavior and closes when it loses focus. Use the header pin button to open the same monitor in a detached extension window when you want it to stay open while browsing. The monitor can be resized vertically from its bottom-right handle in both toolbar-popup and detached-window modes.
