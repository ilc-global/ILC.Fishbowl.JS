#!/usr/bin/env node
/**
 * mock-server.js — Zero-dependency Node.js mock server for fb.js WebAdapter testing.
 *
 * Usage:
 *   node mock-server.js
 *
 * Serves:
 *   - Static files from test/ and js-src/ (for fb.js)
 *   - WebAdapter API endpoints on /api/fb/*
 *
 * Port: 3333 (or PORT env var)
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var PORT = parseInt(process.env.PORT, 10) || 3333;

// ── Static file serving paths ──────────────────────────────────
var TEST_DIR = __dirname;                         // js-src/test/
var JS_SRC_DIR = path.dirname(__dirname);         // js-src/

var MIME_TYPES = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon'
};

// ── In-memory stores ────────────────────────────────────────────
var pluginDataStore = {};

// ── Canned data ────────────────────────────────────────────────
var USER_INFO = {
    companyName: 'Acme Manufacturing',
    username: 'jsmith',
    email: 'jsmith@acme.com',
    userId: 42,
    groups: ['1', '5']
};

var CONTEXT_INFO = {
    pluginName: 'ILC CloudPages',
    moduleName: 'Sales Order',
    objectId: 1001
};

var SALES_ROWS = [
    { State: 'CA', Customer: 'Acme Corp', ProductNumber: 'P100', ProductDescription: 'Widget A', UnitsSold: 50, Revenue: 5000, COGS: 3000, Margin: 2000, SalesRep: 'Alice', LastOrderDate: '2024-06-01', DaysSinceLastOrder: 30 },
    { State: 'CA', Customer: 'Beta LLC', ProductNumber: 'P200', ProductDescription: 'Widget B', UnitsSold: 30, Revenue: 3000, COGS: 1800, Margin: 1200, SalesRep: 'Alice', LastOrderDate: '2024-05-15', DaysSinceLastOrder: 47 },
    { State: 'TX', Customer: 'Gamma Inc', ProductNumber: 'P100', ProductDescription: 'Widget A', UnitsSold: 25, Revenue: 2500, COGS: 1500, Margin: 1000, SalesRep: 'Bob', LastOrderDate: '2024-06-10', DaysSinceLastOrder: 21 },
    { State: 'TX', Customer: 'Epsilon Ltd', ProductNumber: 'P300', ProductDescription: 'Gadget X', UnitsSold: 15, Revenue: 3000, COGS: 2000, Margin: 1000, SalesRep: 'Bob', LastOrderDate: '2024-05-20', DaysSinceLastOrder: 42 },
    { State: 'NY', Customer: 'Delta Co', ProductNumber: 'P300', ProductDescription: 'Gadget X', UnitsSold: 40, Revenue: 8000, COGS: 5000, Margin: 3000, SalesRep: 'Carol', LastOrderDate: '2024-06-20', DaysSinceLastOrder: 11 },
    { State: 'NY', Customer: 'Zeta Group', ProductNumber: 'P100', ProductDescription: 'Widget A', UnitsSold: 20, Revenue: 2000, COGS: 1200, Margin: 800, SalesRep: 'Carol', LastOrderDate: '2024-06-05', DaysSinceLastOrder: 26 },
    { State: 'FL', Customer: 'Eta Systems', ProductNumber: 'P200', ProductDescription: 'Widget B', UnitsSold: 35, Revenue: 3500, COGS: 2100, Margin: 1400, SalesRep: 'Dave', LastOrderDate: '2024-06-12', DaysSinceLastOrder: 19 },
    { State: 'WA', Customer: 'Theta Tech', ProductNumber: 'P400', ProductDescription: 'Doohickey Z', UnitsSold: 10, Revenue: 5000, COGS: 3500, Margin: 1500, SalesRep: 'Eve', LastOrderDate: '2024-06-18', DaysSinceLastOrder: 13 }
];

// ── Helpers ─────────────────────────────────────────────────────

function readBody(req) {
    return new Promise(function (resolve) {
        var chunks = [];
        req.on('data', function (chunk) { chunks.push(chunk); });
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    });
}

function sendJSON(res, statusCode, data) {
    var body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(body);
}

function serveStaticFile(res, filePath) {
    var ext = path.extname(filePath).toLowerCase();
    var mime = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404, {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*'
            });
            res.end('Not found: ' + filePath);
            return;
        }
        res.writeHead(200, {
            'Content-Type': mime,
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}

// ── API Router ──────────────────────────────────────────────────

function handleApi(req, res, parsedUrl) {
    var apiPath = parsedUrl.pathname.replace(/^\/api\/fb/, '');
    var method = req.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // POST /api/fb/query
    if (apiPath === '/query' && method === 'POST') {
        readBody(req).then(function (body) {
            var data = JSON.parse(body);
            console.log('[mock] POST /query:', data.sql);
            sendJSON(res, 200, SALES_ROWS);
        });
        return;
    }

    // GET /api/fb/user/info
    if (apiPath === '/user/info' && method === 'GET') {
        sendJSON(res, 200, USER_INFO);
        return;
    }

    // GET /api/fb/context/info
    if (apiPath === '/context/info' && method === 'GET') {
        sendJSON(res, 200, CONTEXT_INFO);
        return;
    }

    // POST /api/fb/user/access-right
    if (apiPath === '/user/access-right' && method === 'POST') {
        readBody(req).then(function (body) {
            var data = JSON.parse(body);
            console.log('[mock] POST /user/access-right:', data.name);
            sendJSON(res, 200, { hasRight: true });
        });
        return;
    }

    // GET /api/fb/plugin-data?group=X&key=Y
    if (apiPath === '/plugin-data' && method === 'GET') {
        var query = parsedUrl.query || {};
        var storeKey = (query.group || '') + '::' + (query.key || '');
        var val = pluginDataStore[storeKey];
        sendJSON(res, 200, { value: val !== undefined ? val : null });
        return;
    }

    // POST /api/fb/plugin-data
    if (apiPath === '/plugin-data' && method === 'POST') {
        readBody(req).then(function (body) {
            var data = JSON.parse(body);
            var group = data.group;
            var map = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
            if (map && typeof map === 'object') {
                Object.keys(map).forEach(function (k) {
                    pluginDataStore[group + '::' + k] = map[k];
                });
            }
            console.log('[mock] POST /plugin-data:', group, map);
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    // DELETE /api/fb/plugin-data?group=X
    if (apiPath === '/plugin-data' && method === 'DELETE') {
        var delQuery = parsedUrl.query || {};
        var delGroup = delQuery.group || '';
        var prefix = delGroup + '::';
        Object.keys(pluginDataStore).forEach(function (k) {
            if (k.indexOf(prefix) === 0) delete pluginDataStore[k];
        });
        console.log('[mock] DELETE /plugin-data:', delGroup);
        sendJSON(res, 200, { success: true });
        return;
    }

    // POST /api/fb/rest-api
    if (apiPath === '/rest-api' && method === 'POST') {
        readBody(req).then(function (body) {
            var data = JSON.parse(body);
            console.log('[mock] POST /rest-api:', data.method, data.path);
            sendJSON(res, 200, { http_code: '200', response: '{"items":[]}' });
        });
        return;
    }

    // POST /api/fb/legacy-api
    if (apiPath === '/legacy-api' && method === 'POST') {
        readBody(req).then(function (body) {
            var data = JSON.parse(body);
            console.log('[mock] POST /legacy-api:', data.request_type);
            sendJSON(res, 200, { status: 'ok', type: data.request_type });
        });
        return;
    }

    // POST /api/fb/import-csv
    if (apiPath === '/import-csv' && method === 'POST') {
        readBody(req).then(function () {
            sendJSON(res, 200, { is_error: false, rows_imported: 5 });
        });
        return;
    }

    // POST /api/fb/import-csv-json
    if (apiPath === '/import-csv-json' && method === 'POST') {
        readBody(req).then(function () {
            sendJSON(res, 200, { is_error: false, rows_imported: 3 });
        });
        return;
    }

    // POST /api/fb/log
    if (apiPath === '/log' && method === 'POST') {
        readBody(req).then(function (body) {
            var data = JSON.parse(body);
            console.log('[mock][' + (data.level || 'INFO') + '] ' + data.message);
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    // 404 for unknown API routes
    sendJSON(res, 404, { error: 'Unknown API route: ' + apiPath });
}

// ── HTTP Server ────────────────────────────────────────────────

var server = http.createServer(function (req, res) {
    var parsedUrl = url.parse(req.url, true);
    var pathname = parsedUrl.pathname;

    // API routes
    if (pathname.indexOf('/api/fb') === 0) {
        handleApi(req, res, parsedUrl);
        return;
    }

    // CORS preflight for any route
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // Static file serving
    // /fb/fb.js → js-src/fb/fb.js
    if (pathname === '/fb/fb.js') {
        serveStaticFile(res, path.join(JS_SRC_DIR, 'fb', 'fb.js'));
        return;
    }

    // Default: serve from test/ directory
    var safePath = pathname.replace(/\.\./g, '');
    if (safePath === '/') safePath = '/test-web.html';
    var filePath = path.join(TEST_DIR, safePath);

    // Check if file exists in test dir, then try js-src dir
    fs.access(filePath, fs.constants.R_OK, function (err) {
        if (!err) {
            serveStaticFile(res, filePath);
        } else {
            // Try js-src directory
            var jsSrcPath = path.join(JS_SRC_DIR, safePath);
            fs.access(jsSrcPath, fs.constants.R_OK, function (err2) {
                if (!err2) {
                    serveStaticFile(res, jsSrcPath);
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found: ' + pathname);
                }
            });
        }
    });
});

server.listen(PORT, function () {
    console.log('');
    console.log('  fb.js Mock Server');
    console.log('  ─────────────────────────────────────');
    console.log('  Local:   http://localhost:' + PORT + '/');
    console.log('  API:     http://localhost:' + PORT + '/api/fb/*');
    console.log('  fb.js:   http://localhost:' + PORT + '/fb/fb.js');
    console.log('');
    console.log('  Test pages:');
    console.log('    http://localhost:' + PORT + '/test-web.html');
    console.log('    http://localhost:' + PORT + '/test-demo.html');
    console.log('    http://localhost:' + PORT + '/test-compat.html');
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');
});
