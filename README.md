# ILC.Fishbowl.JS

JavaScript client libraries for Fishbowl ERP integration in ILC CloudPages.

## Libraries

| Library | Path | Description |
|---|---|---|
| **[fb.js](fb/)** | `fb/fb.js` | Cross-platform client library — abstracts the JXBrowser bridge behind an adapter pattern (JXBrowser, Web, Demo) |
| **[fishbowl.js](fishbowl/)** | `fishbowl/fishbowl.js` | CSV generation for all 56 Fishbowl import types + API request building for all 109 legacy API call types |

Both are single-file, zero-dependency, UMD modules. Include via `<script>` tag, CommonJS `require()`, or AMD.

## Quick Start

```html
<script src="fb/fb.js"></script>
<script src="fishbowl/fishbowl.js"></script>
<script>
    // Query the database
    var parts = FB.query("SELECT num, description FROM part WHERE activeFlag = :active", { active: "1" });

    // Build and send a CSV import
    var imp = FishbowlCSV.AddInventory({
        PartNumber: 'B201', Location: 'Main Warehouse',
        Qty: '10', UOM: 'ea', Cost: '5.00'
    });
    FB.importCSV('ImportAddInventory', imp.toCSV());

    // Call a legacy API
    var rq = FishbowlJSON.PartGetRq({ Number: 'B201' });
    var rs = FB.legacyApi(rq);
</script>
```

## Project Structure

```
ILC.Fishbowl.JS/
├── README.md                      # ← You are here
├── fb/
│   ├── fb.js                      # Cross-platform client library
│   └── README.md                  # fb.js API reference & documentation
├── fishbowl/
│   ├── fishbowl.js                # CSV + JSON API library
│   └── README.md                  # fishbowl.js documentation & Fishbowl reference links
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

## Documentation

- **[fb.js Reference](fb/README.md)** — Full API reference, configuration, error handling, backward compatibility
- **[fishbowl.js Reference](fishbowl/README.md)** — CSV import types, JSON API factories, Fishbowl documentation links
- **[Test Suite](test/README.md)** — 106 tests across 3 adapters
- **[Demo Pages](demo/README.md)** — Interactive demos using DemoAdapter

## Testing

```bash
node test/run-tests.js          # all 106 tests
node test/run-tests.js compat   # JXBrowser/compat tests only
node test/run-tests.js demo     # DemoAdapter tests only
node test/run-tests.js web      # WebAdapter tests (auto-starts mock server)
```
