# fb.js Demos

Three demo pages showcasing `fb.js` in demo mode. Open any HTML file directly in a browser — no server required.

## Demo Pages

### demo-sales-report.html

Sortable data table with filtering and CSV export.

- 20-row sales dataset with state, customer, product, revenue, margin, and sales rep columns
- Column sorting (click headers)
- Filter bar: date range, state dropdown, sales rep dropdown
- Summary totals row (units, revenue, COGS, margin)
- CSV export button
- Bootstrap 5 UI

### demo-client-info.html

User and context information display with plugin data CRUD.

- Reads user info via `FB.*Async()` methods: company name, username, email, user ID, group IDs, access rights
- Reads context info: plugin name, module name, object ID
- Displays environment, bridge version, and timezone info
- Plugin data workflow: save → read → delete with status feedback

### demo-query-explorer.html

Interactive SQL query executor with dual output views.

- SQL textarea with 5 example queries (click to load)
- Execute with button or Ctrl+Enter
- Table view: auto-generated column headers from result data
- JSON view: syntax-highlighted raw output
- Example queries: SalesByTerritory, PartList, CustomerList, `SELECT 1 AS test`, non-existent query (empty result)

## How Demo Mode Works

Demo mode uses the `DemoAdapter`, which returns data from an in-memory `demoData` config object instead of making network calls or bridge calls.

### demoData Structure

```javascript
FB.configure({
    environment: 'demo',
    demoData: {
        queries: {
            "QueryKeyOrName": [
                { col1: "value1", col2: "value2" },
                // ... rows
            ]
        },
        user: {
            companyName: "Acme Manufacturing",
            username: "jsmith",
            email: "jsmith@acme.com",
            userId: 42,
            groups: ["1", "5"]
        },
        context: {
            pluginName: "ILC CloudPages",
            moduleName: "Sales Order",
            objectId: 1001
        }
    }
});
```

### Query Matching Logic

When `FB.queryAsync(sql)` is called in demo mode, the adapter resolves data in this order:

1. **Script tag ID** — looks for `<script type="text/plain" id="sql">` in the DOM
2. **Exact key match** — `demoData.queries[sql]`
3. **Substring match** — first key in `demoData.queries` where `sql` contains the key
4. **Empty array** — returns `[]` if no match found

This allows you to use either script tag IDs (like existing CloudPages) or direct query key names.

## Using as Templates

To create a new demo page:

1. Copy any `demo-*.html` file
2. Replace the `demoData` object with your own query data, user info, and context
3. Update the HTML/UI for your use case
4. Add your SQL queries as keys in `demoData.queries`

The demo pages use Bootstrap 5 via CDN and have no other dependencies beyond `fb.js`.
