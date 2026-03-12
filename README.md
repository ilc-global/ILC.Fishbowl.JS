# fb.js

Cross-platform client library for ILC CloudPages.

## Overview

`fb.js` abstracts the JXBrowser `fb_client` Java bridge behind an adapter pattern so CloudPages can run identically in three environments:

| Environment | Adapter | How it works |
|---|---|---|
| **JXBrowser** | `JXBrowserAdapter` | Delegates directly to `window.fb_client` (sync + async) |
| **Web** | `WebAdapter` | Sends HTTP requests to a server API (async only) |
| **Demo** | `DemoAdapter` | Returns static data from an in-memory config (async only) |

Sync methods (e.g. `FB.query()`) are JXBrowser-only and throw `PlatformError` in other environments. Every sync method has an `Async` variant (e.g. `FB.queryAsync()`) that returns a `Promise` and works everywhere.

## Project Structure

```
js-src/
├── fb.js                          # Main library (v1.0.0, ~1960 lines)
├── README.md                      # ← You are here
├── test/
│   ├── README.md                  # Test suite documentation
│   ├── run-tests.js               # Headless Puppeteer test runner
│   ├── mock-server.js             # Zero-dependency Node.js mock API server
│   ├── test-compat.html           # 41 tests — JXBrowser adapter + FB.compat()
│   ├── test-demo.html             # 34 tests — DemoAdapter
│   ├── test-web.html              # 31 tests — WebAdapter against mock server
│   └── index.html                 # Test hub page
└── demo/
    ├── README.md                  # Demo page documentation
    ├── demo-sales-report.html     # Sortable sales table with filters + CSV export
    ├── demo-client-info.html      # User/context info + plugin data CRUD
    ├── demo-query-explorer.html   # Interactive SQL explorer with table + JSON view
    └── index.html                 # Demo hub page
```

## Quick Start

### JXBrowser (inside ILC CloudPages)

No configuration needed — `fb.js` auto-detects `window.fb_client`:

```html
<script src="fb.js"></script>
<script>
    var rows = FB.query("SELECT * FROM Parts");
    console.log(rows);
</script>
```

### Demo Mode (static data, no server)

```html
<script src="fb.js"></script>
<script>
    FB.configure({
        environment: 'demo',
        demoData: {
            queries: {
                "MyQuery": [{ id: 1, name: "Example" }]
            },
            user: { companyName: "Acme", username: "jsmith", email: "jsmith@acme.com", userId: 42, groups: ["1"] },
            context: { pluginName: "My Plugin", moduleName: "Orders", objectId: 1001 }
        }
    });

    FB.queryAsync("MyQuery").then(function (rows) {
        console.log(rows);  // [{ id: 1, name: "Example" }]
    });
</script>
```

### Web Mode (HTTP API)

```html
<script src="fb.js"></script>
<script>
    FB.configure({
        environment: 'web',
        apiBaseUrl: 'http://localhost:3333/api/fb'
    });

    FB.queryAsync("SELECT * FROM Parts").then(function (rows) {
        console.log(rows);
    });
</script>
```

## Configuration

Call `FB.configure(opts)` before any data methods. All options are optional.

| Option | Type | Default | Description |
|---|---|---|---|
| `environment` | `string` | `'auto'` | `'jxbrowser'`, `'web'`, `'demo'`, or `'auto'` (detect) |
| `apiBaseUrl` | `string` | `'/api/fb'` | Base URL for WebAdapter HTTP requests |
| `demoData` | `object` | `null` | Inline demo data (`{ queries, user, context }`) |
| `demoDataElement` | `string` | `null` | CSS selector for a `<script type="application/json">` tag containing demo data |
| `demoDataPath` | `string` | `null` | URL path prefix for fetching demo JSON files |
| `statusElement` | `string` | `'#fb-status'` | CSS selector for the status text element |
| `progressElement` | `string` | `'#fb-progress'` | CSS selector for the progress bar element |
| `onPlatformOnly` | `string` | `'warn'` | Behavior for JXBrowser-only methods: `'warn'`, `'silent'`, or `'throw'` |
| `requestTimeout` | `number` | `30000` | Timeout in ms for WebAdapter HTTP requests |

## API Reference

### Properties

| Property | Type | Description |
|---|---|---|
| `FB.version` | `string` | Library version (`'1.0.0'`) |
| `FB.environment` | `string` | Detected environment: `'jxbrowser'`, `'web'`, or `'demo'` |
| `FB.isJXBrowser` | `boolean` | `true` if running in JXBrowser |
| `FB.isWeb` | `boolean` | `true` if running in web mode |
| `FB.isDemo` | `boolean` | `true` if running in demo mode |
| `FB.bridgeVersion` | `string\|null` | Bridge version: `'2024'`, `'2025'`, or `null` |

### Data Operations

| Method | Sync | Async | Description |
|---|---|---|---|
| `query(sql, params?)` | JXB | All | Execute a SQL query |
| `restApi(method, path, body?)` | JXB | All | Call the REST API |
| `legacyApi(type, payload)` | JXB | All | Call the legacy JSON API |
| `importCSV(type, csv)` | JXB | All | Import CSV string data |
| `importCSVFromJSON(type, json)` | JXB | All | Import CSV data from JSON |

Sync methods return parsed data directly. Async variants (`queryAsync`, `restApiAsync`, etc.) return a `Promise`.

### User & Context

| Method | Sync | Async | Description |
|---|---|---|---|
| `getCompanyName()` | JXB | All | Company name |
| `getUsername()` | JXB | All | Current username |
| `getUserEmail()` | JXB | All | User email address |
| `getUserId()` | JXB | All | Numeric user ID |
| `getUserGroupIds()` | JXB | All | Array of group ID strings |
| `hasAccessRight(name)` | JXB | All | Check if user has a named access right |
| `getPluginName()` | JXB | All | Current plugin name |
| `getModuleName()` | JXB | All | Current module name |
| `getObjectId()` | JXB | All | Current object ID |

All have async variants (e.g. `getCompanyNameAsync()`, `getUsernameAsync()`).

### Plugin Data

| Method | Sync | Async | Description |
|---|---|---|---|
| `getPluginData(group, key)` | JXB | All | Read a plugin data value |
| `savePluginData(group, data)` | JXB | All | Save key-value map for a group |
| `deletePluginData(group)` | JXB | All | Delete all data for a group |

All have async variants (`getPluginDataAsync`, `savePluginDataAsync`, `deletePluginDataAsync`).

### UI

| Method | Platform | Description |
|---|---|---|
| `setStatus(msg)` | All | Set status bar text (bridge + DOM) |
| `setProgress(value)` | All | Set progress bar (0–100, or -1 for indeterminate) |
| `closeDialog()` | All | Close the CloudPages dialog |
| `showStatusBar(show)` | All | Show/hide the status bar |
| `toggleFullscreen()` | All | Toggle fullscreen mode |
| `saveFile(title, ext, desc, b64, name, open)` | JXB | Save a base64-encoded file via file dialog |
| `getResourceFileAsync(path)` | All | Get a resource file as a string (async) |
| `getResourceFileBase64Async(path)` | All | Get a resource file as base64 (async) |

### Platform-Only (JXBrowser)

These methods are only available inside JXBrowser. In other environments, behavior depends on the `onPlatformOnly` config setting (`'warn'`, `'silent'`, or `'throw'`).

| Method | Description |
|---|---|
| `hyperLink(module, param)` | Open a hyperlink in the ILC client |
| `reloadObject()` | Reload the current object |
| `runScheduledTask(name)` | Trigger a scheduled task |
| `previewReport(id, params)` | Preview a Jasper report |
| `getReportPDF(id, params, throwException?)` | Get report as base64 PDF |
| `getMergedReportsPDF(dict)` | Merge multiple reports into one PDF |
| `localPrinters()` | List available local printers |
| `printPDF(printer, b64, dialog?)` | Print a base64 PDF |
| `printReportPDF(printer, copies, id, params, throwException?)` | Print a report directly |
| `printMergedReportsPDF(printer, copies, dict)` | Print merged reports |
| `printMultipleReports(dict, printer)` | Print multiple reports |
| `printZPL(printer, zpl)` | Send ZPL to a label printer |

### Logging

| Method | Platform | Description |
|---|---|---|
| `log(msg)` | All | Log an info message |
| `logError(msg)` | All | Log an error message |
| `logMessages()` | All | Flush the log buffer and return all messages |

### Timezone

| Method | Platform | Description |
|---|---|---|
| `getTimeForServer(tz?)` | All | Get current time formatted for the server |
| `convertServerTimeToClient(serverDatetimeStr, serverTz)` | All | Convert server datetime to client timezone |
| `convertClientTimeToServer(clientDatetimeStr, serverTz)` | All | Convert client datetime to server timezone |

### Utilities

| Method | Description |
|---|---|
| `configure(opts)` | Set configuration options (see [Configuration](#configuration)) |
| `compat()` | Install backward-compatible global functions |
| `listMethods()` | List all methods and their availability for the current environment |

## Error Handling

`fb.js` provides a typed error hierarchy. All errors extend `FBError`:

```
FBError
├── PlatformError   — sync method called outside JXBrowser
├── QueryError      — SQL query returned an error
└── ApiError        — REST/Legacy API call failed
```

Async methods throw on errors. Sync methods return the raw `{is_error, error_msg}` object.

```javascript
// Async — errors are thrown (use try/catch or .catch())
try {
    var rows = await FB.queryAsync("SELECT * FROM BadTable");
} catch (e) {
    if (e instanceof FB.QueryError) {
        console.error("SQL failed:", e.sql, e.errorMsg);
    }
}

// PlatformError — calling a sync method outside JXBrowser
try {
    FB.query("SELECT 1");  // throws in demo/web mode
} catch (e) {
    if (e instanceof FB.PlatformError) {
        console.error(e.method, "not available in", e.environment);
    }
}

// ApiError — REST/Legacy API failure
FB.restApiAsync("GET", "/bad/path").catch(function (e) {
    if (e instanceof FB.ApiError) {
        console.error("API error:", e.message, "HTTP:", e.httpCode);
    }
});
```

Error constructors are exposed on `FB` for `instanceof` checks: `FB.FBError`, `FB.PlatformError`, `FB.QueryError`, `FB.ApiError`.

## Backward Compatibility

Call `FB.compat()` to install global helper functions that existing CloudPages expect:

```javascript
FB.compat();

// Now available as globals:
var rows = fb_query("SELECT * FROM Parts");
setStatus("Loading...");
setProgress(50);
var sql = getSQL("myQueryId");  // reads <script type="text/plain" id="myQueryId">
```

| Global | Maps to |
|---|---|
| `fb_query(sql, params)` | `FB.query(sql, params)` |
| `setStatus(msg)` | `FB.setStatus(msg)` |
| `setProgress(val)` | `FB.setProgress(val)` |
| `getSQL(id)` | Reads `document.getElementById(id).textContent` |

## Testing

106 tests across 3 test pages (41 + 34 + 31).

Run headless with Puppeteer:

```bash
node test/run-tests.js          # all tests
node test/run-tests.js compat   # JXBrowser/compat tests only
node test/run-tests.js demo     # DemoAdapter tests only
node test/run-tests.js web      # WebAdapter tests (auto-starts mock server)
```

Or open the HTML files directly in a browser. See [test/README.md](test/README.md) for details.

## Demos

Three demo pages showcase `fb.js` in demo mode with Bootstrap UI:

- **[demo-sales-report.html](demo/demo-sales-report.html)** — Sortable sales table with state/rep filters and CSV export
- **[demo-client-info.html](demo/demo-client-info.html)** — User/context info display + plugin data CRUD
- **[demo-query-explorer.html](demo/demo-query-explorer.html)** — Interactive SQL explorer with table + JSON views

Open any `demo/*.html` directly in a browser — no server required. See [demo/README.md](demo/README.md) for details.
