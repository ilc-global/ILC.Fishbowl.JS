# fb.js

Cross-platform client library for ILC CloudPages.

## Overview

`fb.js` abstracts the JXBrowser `fb_client` Java bridge behind an adapter pattern so CloudPages can run identically in three environments:

| Environment | Adapter | How it works |
|---|---|---|
| **JXBrowser** | `JXBrowserAdapter` | Delegates directly to `window.fb_client` (sync + async) |
| **BI Script** | `BiScriptAdapter` | Delegates to the functions the BI Script / BI Report module injects on `window` (sync + async) |
| **Web** | `WebAdapter` | Sends HTTP requests to a server API (async only) |
| **Demo** | `DemoAdapter` | Returns static data from an in-memory config (async only) |

Sync methods (e.g. `FB.query()`) are available on the two in-client bridges (JXBrowser and BI Script) and throw `PlatformError` in web/demo. Every sync method has an `Async` variant (e.g. `FB.queryAsync()`) that returns a `Promise` and works everywhere.

### BI Script support

The Fishbowl **BI Script / BI Report** module doesn't expose a `fb_client` object; instead it injects individual functions directly on `window` (`runQuery`, `runQueryAsync`, `getUser`, `hasUserAccess`, `runRestApiAsync`, `runApiRequest`, `getProperty`, `openModule`, `saveSettings`/`loadSettings`, `saveReportData`/`loadReportData`, and domain helpers). `fb.js` auto-detects this environment (`FB.environment === 'biscript'`, `FB.isBiScript === true`) and maps the overlapping surface onto the standard API so a page written for CloudPages runs unchanged inside a BI Script:

| Standard API | BI Script bridge |
|---|---|
| `FB.query(sql, params)` / `FB.queryAsync(...)` | `runQuery` / `runQueryAsync` (params bound client-side — BI has no `:name` binder) |
| `FB.restApiAsync(method, path, body)` | `runRestApiAsync({path, method, body})` (async only; sync `FB.restApi` throws) |
| `FB.legacyApi(type, payload)` | `runApiRequest(type, json)` |
| `FB.getUsername/getUserId/getUserEmail` | parsed from `getUser()` |
| `FB.hasAccessRight(name)` | `hasUserAccess(name)` |
| `FB.getPluginData/savePluginData` | `loadSettings/saveSettings` (key is `group::key`) |
| `FB.setStatus/setProgress` etc. | no-op (BI has no dialog UI) |

`getUser()` is returned with password, MFA secret and the group-relation list stripped server-side, so `FB.getUserGroupIds()` returns `[]` in BI. CSV import, report/PDF/printing, and CloudPages dialog UI have no BI equivalent and throw `PlatformError`.

**BI-native extras** (no CloudPages equivalent) are exposed under `FB.bi.*`, mapping 1:1 to the injected functions: `getProperty`, `getLocationGroupList`, `openModule`, `roundMoney`, `formatCurrency`, `currencyLocale`, `getCompanyAddress`, `saveSettings`/`loadSettings`, `saveReportData`/`loadReportData`, `getImageFile`, `getIcon`, `getHighValueReport`, `getParentName`, `getAllTrackingInfo`, `getAutoPo`, `getAutoMo`, `runPickStatusHelper`. These throw `PlatformError` outside the BI Script environment.

## Project Structure

```
fb/
├── fb.js                          # Main library (v1.0.0, ~1960 lines)
└── README.md                      # ← You are here
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

**In the Fishbowl client, the async variants are genuinely non-blocking.** They
call the bridge's own async methods (`runQueryParametersAsync`,
`restApiCallAsync`, `runApiJSONAsync`, `runImportCSVAsync`,
`runImportCSV_JSONAsync`), which run the work on the plugin's thread pool and
answer through a callback. The sync methods block the JxBrowser UI thread for
the whole call, so a slow query freezes the client — prefer the async variant
for anything a person waits on.

A plugin build without those bridge methods falls back to the sync call wrapped
in a resolved promise: the same answer, still blocking. Nothing to configure;
`fb.js` detects it.

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
| `serverLogMessages()` | JXB | The Fishbowl server's log. `''` elsewhere, and on a bridge that lacks it |

The bridge spells its method `serverLogMessges` — the typo is in the Java and
has shipped for years. `fb.js` wraps it under the correct spelling.

### Hardware (2025.11 plugin and later)

Check `FB.hasHardware` first — it is feature-detected, not inferred from a
version. The 2024.12 plugin targets Java 1.8 and cannot carry this bridge.

| Namespace | Methods |
|---|---|
| `FB.scale` | `list()` `start(handler)` `stop()` `snapshot()` `config()` |
| `FB.scanner` | `on('scan', handler)` `status()` `open(port?, baud?)` `close()` `dispatchKeyboardScan(text)` `config()` |
| `FB.serial` | `list()` `open({port, baud, startChar, endChar})` `close()` `status()` |
| `FB.tcp` | `connect(host, port)` `send(id, data)` `close(id)` `list()` `on('data', handler)` |
| `FB.printNetworkZPL(host, port, zpl)` | one-shot connect → send → close, usually port 9100 |

```javascript
if (FB.hasHardware) {
    FB.scale.start(function (f) { show(f.lbs, f.stable); });   // streams until stop()
    var off = FB.scanner.on('scan', function (s) { add(s.raw); });
    FB.tcp.connect('10.0.0.50', 9100).then(function (id) { return FB.tcp.send(id, 'W\r\n'); });
}
```

**Streams are events, not promises.** `FB.scale.start` calls its handler
repeatedly — roughly every 100 ms, and it keeps going across an unplug because
the poller reconnects. Scans and inbound TCP bytes never reach a callback at
all: the plugin dispatches `ilc-scan` and `ilc-tcp-data` window events, and
`FB.scanner.on` / `FB.tcp.on` wrap them. Both return an unsubscribe function —
a page that opens a device and never lets go leaks across navigations.

`FB.tcp.on('data')` decodes the event's base64 and hands the handler
`{id, text, base64}`.

A scale frame carries the weight in **both systems**, plus what the device
itself is showing:

```json
{ "lbs": 2.5574, "kg": 1.16, "native": 1160,
  "unit": "g", "system": "si", "stable": true, "status": 4 }
```

| Field | Meaning |
|---|---|
| `lbs` / `kg` | the same weight, in each system. Pick the one your customer thinks in |
| `native` | the number on the scale's own display |
| `unit` | the unit the **device** is set to — `lbs`, `oz`, `kg`, `g`, `mg`, `ct`, `unknown` |
| `system` | `imperial`, `si`, or `unknown` |

**`unit` describes the device, not the value of `lbs`.** Rendering
`f.lbs + ' ' + f.unit` prints a wrong number with a wrong unit; use `f.native`
when showing an operator what their scale reads, and `lbs`/`kg` for anything
that is stored, priced, or shipped.

An unrecognised unit gives `{lbs: 0, kg: 0, native: 0, unit: "unknown"}` — a
reading a page can refuse. It is never a raw count in a field named `lbs`.

Verified against a Dymo M25 on 2026-08-07: 1.160 kg reads
`{lbs: 2.5574, kg: 1.16, native: 1160, unit: "g", system: "si"}`, and
`FB.scale.snapshot()` agrees with the stream field for field.

One-shot hardware calls that can fail — `FB.tcp.connect`, `FB.tcp.send`,
`FB.serial.open` — reject when the bridge answers `{ok: false}`, so a failure
to open a port reads like every other failure in this library.

> The hardware bridge base64-round-trips its payloads and calls back with
> `atob(...)`, so every hardware answer arrives as a **JSON string**, unlike the
> data methods, which hand over a value the JS engine has already parsed.
> `fb.js` parses hardware payloads for you; do not parse them twice.

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
