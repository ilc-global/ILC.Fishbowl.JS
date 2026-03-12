# fb.js Test Suite

106 tests across 3 test pages covering JXBrowser, Demo, and Web adapters.

## Running Tests

### Headless (Puppeteer)

Requires Node.js and Puppeteer (`npm install puppeteer`).

```bash
node run-tests.js              # run all 106 tests
node run-tests.js compat       # run test-compat.html only (41 tests)
node run-tests.js demo         # run test-demo.html only (34 tests)
node run-tests.js web          # run test-web.html only (31 tests)
```

Exit code: `0` if all tests pass, `1` if any fail. The web suite automatically starts and stops the mock server.

### Browser

Open HTML files directly for interactive debugging:

- **test-compat.html** — open as a local file (`file://`)
- **test-demo.html** — open as a local file (`file://`)
- **test-web.html** — must be served through mock-server (see below)

## Test Pages

### test-compat.html — 41 tests

Tests the JXBrowserAdapter using a fake `window.fb_client` object. Covers:

- Sync data methods: `query`, `restApi`, `legacyApi`, `importCSV`, `importCSVFromJSON`
- Async wrappers of sync methods: `queryAsync`, `restApiAsync`, etc.
- User & context getters: `getCompanyName`, `getUsername`, `getUserEmail`, `getUserId`, `getUserGroupIds`, `hasAccessRight`, `getPluginName`, `getModuleName`, `getObjectId`
- Plugin data: `getPluginData`, `savePluginData`, `deletePluginData` (sync + async)
- UI methods: `setStatus`, `setProgress`, `closeDialog`, `showStatusBar`, `toggleFullscreen`
- Platform-only methods: `hyperLink`, `reloadObject`, `runScheduledTask`, `previewReport`, reports, printing
- Logging: `log`, `logError`, `logMessages`
- Timezone: `getTimeForServer`, `convertServerTimeToClient`, `convertClientTimeToServer`
- `FB.compat()` globals: `fb_query`, `setStatus`, `setProgress`, `getSQL`

### test-demo.html — 34 tests

Tests the DemoAdapter with inline demo data. Covers:

- Async data methods: `queryAsync` with exact key match, substring match, and empty result
- `PlatformError` thrown on sync method calls
- User & context async getters
- Plugin data CRUD: `savePluginDataAsync`, `getPluginDataAsync`, `deletePluginDataAsync`
- Query matching logic: script tag ID → exact key → substring → empty array
- UI methods in demo mode

### test-web.html — 31 tests

Tests the WebAdapter against the mock server over HTTP. Covers:

- Async data methods: `queryAsync`, `restApiAsync`, `legacyApiAsync`, `importCSVAsync`, `importCSVFromJSONAsync`
- User & context async getters (HTTP GET)
- Access right check (HTTP POST)
- Plugin data CRUD via HTTP: GET, POST, DELETE
- Logging via HTTP POST
- `PlatformError` on sync method calls

## Mock Server

Zero-dependency Node.js server for WebAdapter testing.

```bash
node mock-server.js                # default port 3333
PORT=4000 node mock-server.js      # custom port
```

Serves static files from `test/` and `js-src/`, plus the following API endpoints:

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/fb/query` | Execute a SQL query (returns canned sales data) |
| GET | `/api/fb/user/info` | Get user info (company, username, email, id, groups) |
| GET | `/api/fb/context/info` | Get context info (plugin name, module, object ID) |
| POST | `/api/fb/user/access-right` | Check access right (always returns `true`) |
| GET | `/api/fb/plugin-data?group=X&key=Y` | Read plugin data value |
| POST | `/api/fb/plugin-data` | Save plugin data (key-value map) |
| DELETE | `/api/fb/plugin-data?group=X` | Delete all plugin data for a group |
| POST | `/api/fb/rest-api` | Proxy REST API call (returns `{"items":[]}`) |
| POST | `/api/fb/legacy-api` | Proxy legacy API call (echoes request type) |
| POST | `/api/fb/import-csv` | Import CSV (returns `rows_imported: 5`) |
| POST | `/api/fb/import-csv-json` | Import CSV from JSON (returns `rows_imported: 3`) |
| POST | `/api/fb/log` | Log a message (prints to server console) |

Plugin data is stored in-memory and resets when the server restarts.

## Adding Tests

Each test page uses a minimal built-in test framework:

```javascript
test("description of what is being tested", function () {
    var result = FB.someMethod();
    assert(result === expected, "Expected " + expected + ", got " + result);
});

// Async tests — return a Promise
test("async method works", function () {
    return FB.queryAsync("MyQuery").then(function (rows) {
        assert(rows.length > 0, "Expected rows");
    });
});
```

**Helpers:** `assert(condition, message)` — logs pass/fail to a `<table id="results">` element. The `<div id="summary">` element gets a `pass` or `fail` CSS class when the suite completes, which the headless runner uses to detect completion.
