#!/usr/bin/env node
/**
 * run-tests.js — Headless browser test runner for fb.js test pages.
 *
 * Uses Puppeteer to open each test HTML page, wait for the test suite
 * to complete, and report pass/fail results to the terminal.
 *
 * Usage:
 *   node run-tests.js              # run all tests
 *   node run-tests.js demo         # run only test-demo.html
 *   node run-tests.js compat       # run only test-compat.html
 *   node run-tests.js web          # run only test-web.html (starts mock server)
 *
 * Exit code: 0 if all tests pass, 1 if any fail.
 */

var path = require('path');
var http = require('http');
var childProcess = require('child_process');

var TEST_DIR = __dirname;
var MOCK_SERVER_PORT = 3333;
var TEST_TIMEOUT = 15000; // ms to wait for tests to complete

// ── Colors for terminal output ─────────────────────────────────
var c = {
    green: function (s) { return '\x1b[32m' + s + '\x1b[0m'; },
    red: function (s) { return '\x1b[31m' + s + '\x1b[0m'; },
    yellow: function (s) { return '\x1b[33m' + s + '\x1b[0m'; },
    cyan: function (s) { return '\x1b[36m' + s + '\x1b[0m'; },
    bold: function (s) { return '\x1b[1m' + s + '\x1b[0m'; },
    dim: function (s) { return '\x1b[2m' + s + '\x1b[0m'; }
};

// ── Test page definitions ──────────────────────────────────────
var TEST_PAGES = {
    compat: {
        label: 'test-compat.html (JXBrowser / Compat)',
        file: 'test-compat.html',
        needsServer: false
    },
    demo: {
        label: 'test-demo.html (DemoAdapter)',
        file: 'test-demo.html',
        needsServer: false
    },
    web: {
        label: 'test-web.html (WebAdapter)',
        file: 'test-web.html',
        needsServer: true
    }
};

// ── Helpers ─────────────────────────────────────────────────────

function waitForPort(port, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var start = Date.now();
        function tryConnect() {
            var req = http.get({ host: '127.0.0.1', port: port, path: '/api/fb/user/info' }, function (res) {
                res.resume();
                resolve();
            });
            req.on('error', function () {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error('Mock server did not start within ' + timeoutMs + 'ms'));
                } else {
                    setTimeout(tryConnect, 200);
                }
            });
            req.end();
        }
        tryConnect();
    });
}

/**
 * Open a test page in headless Chromium, wait for tests to complete,
 * and return the results.
 */
async function runTestPage(browser, pageConfig) {
    var url;
    if (pageConfig.needsServer) {
        url = 'http://localhost:' + MOCK_SERVER_PORT + '/' + pageConfig.file;
    } else {
        url = 'file://' + path.join(TEST_DIR, pageConfig.file);
    }

    var page = await browser.newPage();

    // Collect console messages
    var consoleLogs = [];
    page.on('console', function (msg) {
        consoleLogs.push(msg.text());
    });

    // Collect page errors
    var pageErrors = [];
    page.on('pageerror', function (err) {
        pageErrors.push(err.message);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for the summary element to get a pass/fail class
    try {
        await page.waitForFunction(function () {
            var el = document.getElementById('summary');
            return el && (el.className.indexOf('pass') >= 0 || el.className.indexOf('fail') >= 0);
        }, { timeout: TEST_TIMEOUT });
    } catch (e) {
        await page.close();
        return {
            passed: false,
            summary: 'TIMEOUT — tests did not complete within ' + (TEST_TIMEOUT / 1000) + 's',
            rows: [],
            errors: pageErrors,
            consoleLogs: consoleLogs
        };
    }

    // Extract results from the DOM
    var results = await page.evaluate(function () {
        var summaryEl = document.getElementById('summary');
        var summary = summaryEl ? summaryEl.textContent : 'unknown';
        var allPassed = summaryEl && summaryEl.className.indexOf('pass') >= 0;

        var rows = [];
        var trs = document.querySelectorAll('#results tr');
        for (var i = 0; i < trs.length; i++) {
            var tds = trs[i].querySelectorAll('td');
            if (tds.length >= 4) {
                rows.push({
                    num: tds[0].textContent,
                    name: tds[1].textContent,
                    pass: tds[2].textContent.trim() === 'PASS',
                    detail: tds[3].textContent
                });
            }
        }

        return { passed: allPassed, summary: summary, rows: rows };
    });

    results.errors = pageErrors;
    results.consoleLogs = consoleLogs;

    await page.close();
    return results;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
    var puppeteer = require('puppeteer');

    // Determine which tests to run
    var filter = process.argv[2] || 'all';
    var pagesToRun;
    if (filter === 'all') {
        pagesToRun = Object.keys(TEST_PAGES);
    } else if (TEST_PAGES[filter]) {
        pagesToRun = [filter];
    } else {
        console.error('Unknown test: "' + filter + '". Choose: all, compat, demo, web');
        process.exit(1);
    }

    // Check if mock server is needed
    var needsServer = pagesToRun.some(function (k) { return TEST_PAGES[k].needsServer; });
    var mockServerProcess = null;

    if (needsServer) {
        console.log(c.dim('Starting mock server on port ' + MOCK_SERVER_PORT + '...'));
        mockServerProcess = childProcess.spawn('node', [path.join(TEST_DIR, 'mock-server.js')], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, { PORT: String(MOCK_SERVER_PORT) })
        });

        // Suppress output
        mockServerProcess.stdout.on('data', function () {});
        mockServerProcess.stderr.on('data', function () {});

        try {
            await waitForPort(MOCK_SERVER_PORT, 5000);
            console.log(c.dim('Mock server ready.\n'));
        } catch (e) {
            console.error(c.red('Failed to start mock server: ' + e.message));
            process.exit(1);
        }
    }

    // Launch headless browser
    var browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    console.log(c.bold('fb.js Headless Test Runner'));
    console.log(c.dim('─'.repeat(50)));

    var totalPassed = 0;
    var totalFailed = 0;
    var allSuitesPassed = true;

    for (var i = 0; i < pagesToRun.length; i++) {
        var key = pagesToRun[i];
        var pageConfig = TEST_PAGES[key];

        console.log('\n' + c.bold(c.cyan('▶ ' + pageConfig.label)));

        var results = await runTestPage(browser, pageConfig);

        // Print individual test results
        results.rows.forEach(function (row) {
            var status = row.pass ? c.green('PASS') : c.red('FAIL');
            var detail = row.detail && row.detail !== 'OK' ? c.dim(' — ' + row.detail) : '';
            console.log('  ' + status + '  ' + row.name + detail);

            if (row.pass) totalPassed++;
            else totalFailed++;
        });

        // Print page errors if any
        if (results.errors.length > 0) {
            console.log(c.red('\n  Page errors:'));
            results.errors.forEach(function (err) {
                console.log(c.red('    ' + err));
            });
        }

        // Print summary for this page
        if (results.passed) {
            console.log(c.green('\n  ✓ ' + results.summary));
        } else {
            console.log(c.red('\n  ✗ ' + results.summary));
            allSuitesPassed = false;
        }
    }

    // Final summary
    console.log('\n' + c.dim('─'.repeat(50)));
    if (allSuitesPassed) {
        console.log(c.bold(c.green('All ' + totalPassed + ' tests passed across ' + pagesToRun.length + ' page(s).')));
    } else {
        console.log(c.bold(c.red(totalFailed + ' failed, ' + totalPassed + ' passed across ' + pagesToRun.length + ' page(s).')));
    }

    // Cleanup
    await browser.close();
    if (mockServerProcess) {
        mockServerProcess.kill('SIGTERM');
    }

    process.exit(allSuitesPassed ? 0 : 1);
}

main().catch(function (err) {
    console.error(c.red('Fatal error: ' + err.message));
    console.error(err.stack);
    process.exit(1);
});
