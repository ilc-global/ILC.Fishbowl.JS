/**
 * fb.js — ILC CloudPages Cross-Platform Client Library
 *
 * Abstracts the JXBrowser fb_client Java bridge behind an adapter pattern so
 * CloudPages can run identically in JXBrowser, on the web via an HTTP API, or
 * in demo mode with static data.
 *
 * Usage:
 *   <script src="fb.js"></script>          // IIFE → window.FB
 *   import FB from './fb.js';              // ES module
 *
 * @version 1.0.0
 * @license MIT
 * @see https://ilcdocs.atlassian.net/wiki/spaces/CPG
 */
(function (root, factory) {
    // [11] UMD export
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FB = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    // [2] Error Classes
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Base error class for all FB errors.
     * @param {string} message
     */
    function FBError(message) {
        var err = Error.call(this, message);
        this.name = 'FBError';
        this.message = message;
        this.stack = err.stack;
    }
    FBError.prototype = Object.create(Error.prototype);
    FBError.prototype.constructor = FBError;

    /**
     * Thrown when a sync method is called on an unsupported platform.
     * @param {string} method - The method name that was called.
     * @param {string} environment - The current environment.
     */
    function PlatformError(method, environment) {
        var msg = 'FB.' + method + '() is not available in "' + environment + '" mode. ' +
                  'Use FB.' + method + 'Async() for cross-platform support.';
        FBError.call(this, msg);
        this.name = 'PlatformError';
        this.method = method;
        this.environment = environment;
    }
    PlatformError.prototype = Object.create(FBError.prototype);
    PlatformError.prototype.constructor = PlatformError;

    /**
     * Thrown when a SQL query returns an error from the server.
     * @param {string} sql - The SQL that failed.
     * @param {string} errorMsg - The error message from the server.
     */
    function QueryError(sql, errorMsg) {
        FBError.call(this, errorMsg);
        this.name = 'QueryError';
        this.sql = sql;
        this.errorMsg = errorMsg;
    }
    QueryError.prototype = Object.create(FBError.prototype);
    QueryError.prototype.constructor = QueryError;

    /**
     * Thrown when a REST or Legacy API call returns an error.
     * @param {string} message - Error message.
     * @param {string|number} [httpCode] - HTTP status code if applicable.
     */
    function ApiError(message, httpCode) {
        FBError.call(this, message);
        this.name = 'ApiError';
        this.httpCode = httpCode || null;
    }
    ApiError.prototype = Object.create(FBError.prototype);
    ApiError.prototype.constructor = ApiError;

    // ═══════════════════════════════════════════════════════════════════
    // [3] Configuration & Defaults
    // ═══════════════════════════════════════════════════════════════════

    var _config = {
        environment: 'auto',
        apiBaseUrl: '/api/fb',
        demoData: null,
        demoDataElement: null,
        demoDataPath: null,
        statusElement: '#fb-status',
        progressElement: '#fb-progress',
        onPlatformOnly: 'warn',    // 'warn' | 'silent' | 'throw'
        requestTimeout: 30000
    };

    // ═══════════════════════════════════════════════════════════════════
    // [4] Internal Utilities
    // ═══════════════════════════════════════════════════════════════════

    /** Internal log buffer */
    var _logBuffer = [];

    /**
     * Check if the Java bridge has a specific method.
     * JXBrowser throws when accessing non-existent members via typeof,
     * so we must use try/catch instead.
     * @param {object} obj - The bridge object (fb_client).
     * @param {string} name - Method name to check.
     * @returns {boolean}
     */
    function _hasBridgeMethod(obj, name) {
        try { return typeof obj[name] === 'function'; }
        catch (e) { return false; }
    }

    /**
     * Safely parse a JSON string. Returns the parsed value, or the
     * original value if it is already an object or if parsing fails.
     * @param {*} val
     * @returns {*}
     */
    function _safeParse(val) {
        if (val === null || val === undefined) return val;
        if (typeof val !== 'string') return val;
        try { return JSON.parse(val); } catch (e) { return val; }
    }

    /**
     * Parse a bridge return value and check for the is_error pattern.
     * For sync methods: returns parsed data, or the error object with is_error.
     * For async methods: returns parsed data, or throws QueryError/ApiError.
     * @param {*} raw - Raw return from bridge or adapter.
     * @param {boolean} throwOnError - If true, throw on is_error instead of returning.
     * @param {string} [sql] - Optional SQL for QueryError context.
     * @returns {*}
     */
    function _parseAndCheck(raw, throwOnError, sql) {
        var parsed = _safeParse(raw);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.is_error) {
            if (throwOnError) {
                if (sql) {
                    throw new QueryError(sql, parsed.error_msg || parsed.message || 'Unknown query error');
                }
                throw new ApiError(
                    parsed.error_msg || parsed.message || 'Unknown API error',
                    parsed.http_code || null
                );
            }
        }
        return parsed;
    }

    /**
     * Make a fetch request with timeout to the web API.
     * @param {string} path - Relative path appended to apiBaseUrl.
     * @param {object} [options] - fetch options (method, body, etc.)
     * @returns {Promise<*>} Parsed JSON response.
     */
    function _fetchJSON(path, options) {
        var url = _config.apiBaseUrl.replace(/\/+$/, '') + path;
        var opts = options || {};
        opts.headers = opts.headers || {};
        opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';

        // AbortController for timeout
        var controller = null;
        var timeoutId = null;
        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            opts.signal = controller.signal;
            timeoutId = setTimeout(function () { controller.abort(); }, _config.requestTimeout);
        }

        return fetch(url, opts).then(function (res) {
            if (timeoutId) clearTimeout(timeoutId);
            return res.json().then(function (data) {
                if (!res.ok) {
                    throw new ApiError(
                        (data && (data.error_msg || data.message)) || 'HTTP ' + res.status,
                        res.status
                    );
                }
                return data;
            });
        }).catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (err instanceof ApiError) throw err;
            throw new ApiError(err.message || 'Network error');
        });
    }

    /**
     * Guard that throws PlatformError if not in JXBrowser.
     * @param {string} method
     */
    function _syncGuard(method) {
        if (_adapter && !(_adapter instanceof JXBrowserAdapter)) {
            throw new PlatformError(method, FB.environment);
        }
    }

    /**
     * Handle platform-only methods that have no web/demo equivalent.
     * Behavior depends on config.onPlatformOnly: 'warn' | 'silent' | 'throw'.
     * @param {string} method
     * @param {*} [fallback] - Value to return if not throwing.
     * @returns {*}
     */
    function _platformWarn(method, fallback) {
        var msg = 'FB.' + method + '() is only available in JXBrowser. Current environment: "' + FB.environment + '".';
        if (_config.onPlatformOnly === 'throw') {
            throw new PlatformError(method, FB.environment);
        }
        if (_config.onPlatformOnly === 'warn') {
            console.warn('[FB] ' + msg);
        }
        return fallback !== undefined ? fallback : undefined;
    }

    /**
     * Update a DOM element's text content by selector.
     * @param {string} selector
     * @param {string} text
     */
    function _setDomText(selector, text) {
        if (typeof document === 'undefined') return;
        try {
            var el = document.querySelector(selector);
            if (el) el.textContent = text;
        } catch (e) { /* ignore bad selectors */ }
    }

    /**
     * Update a progress element's value (supports <progress>, width%, or data attribute).
     * @param {string} selector
     * @param {number} value - 0–100 or -1 for indeterminate.
     */
    function _setDomProgress(selector, value) {
        if (typeof document === 'undefined') return;
        try {
            var el = document.querySelector(selector);
            if (!el) return;
            if (el.tagName === 'PROGRESS') {
                if (value < 0) { el.removeAttribute('value'); }
                else { el.value = value; el.max = 100; }
            } else {
                el.style.width = (value < 0 ? 100 : value) + '%';
                el.setAttribute('data-progress', value);
            }
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════════════════════════════
    // [5] JXBrowserAdapter
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Adapter that delegates directly to window.fb_client (Java bridge).
     * All methods are synchronous. Async variants wrap in Promise.resolve().
     * @constructor
     */
    function JXBrowserAdapter() {
        this.client = window.fb_client;
    }

    // -- Data Operations --

    /** @param {string} sql  @param {object} [params]  @returns {string} Raw JSON string */
    JXBrowserAdapter.prototype.runQuery = function (sql, params) {
        if (params && Object.keys(params).length > 0) {
            return this.client.runQueryParameters(sql, JSON.stringify(params));
        }
        return this.client.runQuery(sql);
    };

    /** @param {string} method  @param {string} path  @param {string} [body]  @returns {string} */
    JXBrowserAdapter.prototype.restApiCall = function (method, path, body) {
        return this.client.restApiCall(method, path, body || null);
    };

    /** @param {string} type  @param {string} payload  @returns {string} */
    JXBrowserAdapter.prototype.runApiJSON = function (type, payload) {
        return this.client.runApiJSON(type, payload);
    };

    /** @param {string} type  @param {string} csv  @returns {string} */
    JXBrowserAdapter.prototype.runImportCSV = function (type, csv) {
        return this.client.runImportCSV(type, csv);
    };

    /** @param {string} type  @param {string} json  @returns {string} */
    JXBrowserAdapter.prototype.runImportCSV_JSON = function (type, json) {
        return this.client.runImportCSV_JSON(type, json);
    };

    /** @returns {string} */
    JXBrowserAdapter.prototype.getCompanyName = function () {
        return this.client.getCompanyName();
    };

    /** @returns {string} */
    JXBrowserAdapter.prototype.getUsername = function () {
        return this.client.getUsername();
    };

    /** @returns {string} */
    JXBrowserAdapter.prototype.getUserEmail = function () {
        return this.client.getUserEmail();
    };

    /** @returns {number} */
    JXBrowserAdapter.prototype.getUserId = function () {
        return this.client.getUserId();
    };

    /** @returns {string[]} */
    JXBrowserAdapter.prototype.getUserGroupIds = function () {
        var raw = this.client.getUsersGroupIDs();
        // JXBrowser may return a Java List; convert to JS array
        if (raw && typeof raw.toArray === 'function') {
            return Array.prototype.slice.call(raw.toArray());
        }
        if (typeof raw === 'string') return _safeParse(raw);
        return raw;
    };

    /** @param {string} name  @returns {boolean} */
    JXBrowserAdapter.prototype.hasAccessRight = function (name) {
        return !!this.client.hasAccessRight(name);
    };

    /** @returns {string} */
    JXBrowserAdapter.prototype.getPluginName = function () {
        return this.client.getPluginName();
    };

    /** @returns {string} */
    JXBrowserAdapter.prototype.getModuleName = function () {
        return this.client.getModuleName();
    };

    /** @returns {number} */
    JXBrowserAdapter.prototype.getObjectId = function () {
        return this.client.getObjectId();
    };

    /** @param {string} group  @param {string} key  @returns {string} */
    JXBrowserAdapter.prototype.getPluginData = function (group, key) {
        return this.client.getPluginData(group, key);
    };

    /**
     * @param {string} group
     * @param {object|string} data - Key-value map or JSON string.
     * @returns {boolean}
     */
    JXBrowserAdapter.prototype.savePluginData = function (group, data) {
        var json = typeof data === 'string' ? data : JSON.stringify(data);
        return !!this.client.savePluginDataByGroup(group, json);
    };

    /** @param {string} group  @returns {boolean} */
    JXBrowserAdapter.prototype.deletePluginData = function (group) {
        return !!this.client.deletePluginData(group);
    };

    // -- UI Operations --

    JXBrowserAdapter.prototype.dialogStatus = function (msg) { this.client.dialogStatus(msg); };
    JXBrowserAdapter.prototype.pbUpdate = function (value) { this.client.pbUpdate(value); };
    JXBrowserAdapter.prototype.dialogClose = function () { return this.client.dialogClose(); };
    JXBrowserAdapter.prototype.showStatusBar = function (show) { this.client.showStatusBar(show); };
    JXBrowserAdapter.prototype.toggleFullscreen = function () { this.client.toggleFullscreen(); };

    /**
     * @param {string} title  @param {string} ext  @param {string} desc
     * @param {string} b64  @param {string} [name]  @param {boolean} [open]
     */
    JXBrowserAdapter.prototype.saveDataToFile = function (title, ext, desc, b64, name, open) {
        this.client.saveDataToFile(title, ext, desc, b64, name || '', !!open);
    };

    /** @param {string} path  @returns {string} */
    JXBrowserAdapter.prototype.getResourceFileString = function (path) {
        return this.client.getResourceFileString(path);
    };

    /** @param {string} path  @returns {string} */
    JXBrowserAdapter.prototype.getResourceFileBase64 = function (path) {
        return this.client.getResourceFileAsBase64(path);
    };

    // -- Platform-Only Operations --

    JXBrowserAdapter.prototype.hyperLink = function (module, param) { this.client.hyperLink(module, param); };
    JXBrowserAdapter.prototype.reloadObject = function () { return this.client.reloadObject(); };
    JXBrowserAdapter.prototype.runScheduledTask = function (name) { this.client.runScheduledTask(name); };
    JXBrowserAdapter.prototype.previewReport = function (id, params) { this.client.previewReport(String(id), params); };

    JXBrowserAdapter.prototype.getReportPDF = function (id, params, throwEx) {
        return this.client.getReportPDF(String(id), params, !!throwEx);
    };

    JXBrowserAdapter.prototype.getMergedReportsPDF = function (dict) {
        return this.client.getMergedReportsPDF(dict);
    };

    JXBrowserAdapter.prototype.localPrinters = function () {
        return this.client.localPrinters();
    };

    JXBrowserAdapter.prototype.printPDF = function (printer, b64, dialog) {
        this.client.printPDF(printer, b64, !!dialog);
    };

    JXBrowserAdapter.prototype.printReportPDF = function (printer, copies, id, params, throwEx) {
        this.client.printReportPDF(printer, copies, String(id), params, !!throwEx);
    };

    JXBrowserAdapter.prototype.printMergedReportsPDF = function (printer, copies, dict) {
        this.client.printMergedReportsPDF(printer, copies, dict);
    };

    JXBrowserAdapter.prototype.printMultipleReports = function (dict, printer) {
        this.client.printMultipleReports_JasperReports(dict, printer);
    };

    JXBrowserAdapter.prototype.printZPL = function (printer, zpl) {
        this.client.printZPL(printer, zpl);
    };

    // -- Logging --

    JXBrowserAdapter.prototype.logInformation = function (msg) { this.client.logInformation(msg); };
    JXBrowserAdapter.prototype.logError = function (msg) { this.client.logError(msg); };
    JXBrowserAdapter.prototype.logMessages = function () { return this.client.logMessages(); };

    // -- Timezone --

    JXBrowserAdapter.prototype.getTimeForServer = function (tz) {
        if (_hasBridgeMethod(this.client, 'getTimeForServer')) {
            return this.client.getTimeForServer(tz);
        }
        return _tzGetTimeForServer(tz);
    };

    // ═══════════════════════════════════════════════════════════════════
    // [6] WebAdapter
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Adapter that delegates data operations to an HTTP API server.
     * Sync methods throw PlatformError. Async methods use fetch().
     * @constructor
     */
    function WebAdapter() {}

    // -- Async Data Operations --

    WebAdapter.prototype.runQueryAsync = function (sql, params) {
        return _fetchJSON('/query', {
            method: 'POST',
            body: JSON.stringify({ sql: sql, params: params || {} })
        });
    };

    WebAdapter.prototype.restApiCallAsync = function (method, path, body) {
        return _fetchJSON('/rest-api', {
            method: 'POST',
            body: JSON.stringify({ method: method, path: path, body: body || null })
        });
    };

    WebAdapter.prototype.runApiJSONAsync = function (type, payload) {
        return _fetchJSON('/legacy-api', {
            method: 'POST',
            body: JSON.stringify({ request_type: type, payload: payload })
        });
    };

    WebAdapter.prototype.runImportCSVAsync = function (type, csv) {
        return _fetchJSON('/import-csv', {
            method: 'POST',
            body: JSON.stringify({ import_type: type, csv_data: csv })
        });
    };

    WebAdapter.prototype.runImportCSV_JSONAsync = function (type, json) {
        return _fetchJSON('/import-csv-json', {
            method: 'POST',
            body: JSON.stringify({ import_type: type, json_list: json })
        });
    };

    /** @returns {Promise<object>} { companyName, username, email, userId, groups } */
    WebAdapter.prototype._getUserInfo = function () {
        if (this._userInfoCache) return Promise.resolve(this._userInfoCache);
        var self = this;
        return _fetchJSON('/user/info', { method: 'GET' }).then(function (data) {
            self._userInfoCache = data;
            return data;
        });
    };

    WebAdapter.prototype.getCompanyNameAsync = function () {
        return this._getUserInfo().then(function (u) { return u.companyName || ''; });
    };

    WebAdapter.prototype.getUsernameAsync = function () {
        return this._getUserInfo().then(function (u) { return u.username || ''; });
    };

    WebAdapter.prototype.getUserEmailAsync = function () {
        return this._getUserInfo().then(function (u) { return u.email || ''; });
    };

    WebAdapter.prototype.getUserIdAsync = function () {
        return this._getUserInfo().then(function (u) { return u.userId || 0; });
    };

    WebAdapter.prototype.getUserGroupIdsAsync = function () {
        return this._getUserInfo().then(function (u) { return u.groups || []; });
    };

    WebAdapter.prototype.hasAccessRightAsync = function (name) {
        return _fetchJSON('/user/access-right', {
            method: 'POST',
            body: JSON.stringify({ name: name })
        }).then(function (data) { return !!data.hasRight; });
    };

    /** @returns {Promise<object>} { pluginName, moduleName, objectId } */
    WebAdapter.prototype._getContextInfo = function () {
        if (this._contextCache) return Promise.resolve(this._contextCache);
        var self = this;
        return _fetchJSON('/context/info', { method: 'GET' }).then(function (data) {
            self._contextCache = data;
            return data;
        });
    };

    WebAdapter.prototype.getPluginNameAsync = function () {
        return this._getContextInfo().then(function (c) { return c.pluginName || ''; });
    };

    WebAdapter.prototype.getModuleNameAsync = function () {
        return this._getContextInfo().then(function (c) { return c.moduleName || ''; });
    };

    WebAdapter.prototype.getObjectIdAsync = function () {
        return this._getContextInfo().then(function (c) { return c.objectId || 0; });
    };

    // -- Plugin Data (dual storage: localStorage + HTTP API) --

    WebAdapter.prototype.getPluginDataAsync = function (group, key) {
        var lsKey = 'fb_plugin_' + group + '_' + key;
        return _fetchJSON('/plugin-data?group=' + encodeURIComponent(group) + '&key=' + encodeURIComponent(key), {
            method: 'GET'
        }).then(function (data) {
            var val = (data && data.value !== undefined) ? data.value : null;
            // Update localStorage cache
            if (val !== null && typeof localStorage !== 'undefined') {
                try { localStorage.setItem(lsKey, val); } catch (e) { /* ignore */ }
            }
            return val;
        }).catch(function () {
            // Fallback to localStorage
            if (typeof localStorage !== 'undefined') {
                try { return localStorage.getItem(lsKey); } catch (e) { return null; }
            }
            return null;
        });
    };

    WebAdapter.prototype.savePluginDataAsync = function (group, data) {
        var json = typeof data === 'string' ? data : JSON.stringify(data);
        // Write to localStorage immediately
        if (typeof localStorage !== 'undefined') {
            try {
                var map = _safeParse(json);
                if (map && typeof map === 'object') {
                    Object.keys(map).forEach(function (key) {
                        localStorage.setItem('fb_plugin_' + group + '_' + key, map[key]);
                    });
                }
            } catch (e) { /* ignore */ }
        }
        return _fetchJSON('/plugin-data', {
            method: 'POST',
            body: JSON.stringify({ group: group, data: json })
        }).then(function () { return true; }).catch(function () { return true; }); // localStorage write still succeeded
    };

    WebAdapter.prototype.deletePluginDataAsync = function (group) {
        // Clear localStorage entries for group
        if (typeof localStorage !== 'undefined') {
            try {
                var prefix = 'fb_plugin_' + group + '_';
                var keys = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(prefix) === 0) keys.push(k);
                }
                keys.forEach(function (k) { localStorage.removeItem(k); });
            } catch (e) { /* ignore */ }
        }
        return _fetchJSON('/plugin-data?group=' + encodeURIComponent(group), {
            method: 'DELETE'
        }).then(function () { return true; }).catch(function () { return true; });
    };

    // -- UI (browser-native) --

    WebAdapter.prototype.dialogStatus = function (msg) {
        _setDomText(_config.statusElement, msg);
        console.log('[FB Status] ' + msg);
    };

    WebAdapter.prototype.pbUpdate = function (value) {
        _setDomProgress(_config.progressElement, value);
    };

    WebAdapter.prototype.dialogClose = function () {
        try { window.close(); } catch (e) { /* some browsers block this */ }
        return true;
    };

    WebAdapter.prototype.showStatusBar = function (show) {
        if (typeof document === 'undefined') return;
        try {
            var el = document.querySelector(_config.statusElement);
            if (el) el.style.display = show ? '' : 'none';
        } catch (e) { /* ignore */ }
    };

    WebAdapter.prototype.toggleFullscreen = function () {
        if (typeof document === 'undefined') return;
        if (!document.fullscreenElement) {
            (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen ||
             document.documentElement.msRequestFullscreen || function () {}).call(document.documentElement);
        } else {
            (document.exitFullscreen || document.webkitExitFullscreen ||
             document.msExitFullscreen || function () {}).call(document);
        }
    };

    WebAdapter.prototype.saveDataToFile = function (title, ext, desc, b64, name, open) {
        var filename = (name || title || 'download') + (name && name.indexOf('.') >= 0 ? '' : '.' + ext);
        try {
            var binary = atob(b64);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            var blob = new Blob([bytes], { type: 'application/octet-stream' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.error('[FB] saveFile error:', e);
        }
    };

    WebAdapter.prototype.getResourceFileStringAsync = function (path) {
        return fetch(path).then(function (res) {
            if (!res.ok) return '';
            return res.text();
        }).catch(function () { return ''; });
    };

    WebAdapter.prototype.getResourceFileBase64Async = function (path) {
        return fetch(path).then(function (res) {
            if (!res.ok) return '';
            return res.arrayBuffer();
        }).then(function (buf) {
            if (!buf) return '';
            var bytes = new Uint8Array(buf);
            var binary = '';
            for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        }).catch(function () { return ''; });
    };

    // -- Logging --

    WebAdapter.prototype.logInformation = function (msg) {
        console.log('[FB] ' + msg);
    };

    WebAdapter.prototype.logError = function (msg) {
        console.error('[FB] ' + msg);
    };

    WebAdapter.prototype.logAsync = function (level, msg) {
        return _fetchJSON('/log', {
            method: 'POST',
            body: JSON.stringify({ level: level, message: msg })
        }).catch(function () { /* best-effort */ });
    };

    // ═══════════════════════════════════════════════════════════════════
    // [7] DemoAdapter
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Returns pre-configured static data. Sources (in priority order):
     * 1. Inline demoData object from configure()
     * 2. <script type="application/json"> tag (demoDataElement)
     * 3. Fetched JSON files from demoDataPath
     * @constructor
     */
    function DemoAdapter() {
        this._data = null;
        this._loaded = false;
    }

    /**
     * Ensure demo data is loaded from the configured source.
     * @returns {Promise<object>}
     */
    DemoAdapter.prototype._ensureLoaded = function () {
        if (this._loaded) return Promise.resolve(this._data);
        var self = this;

        // Source 1: Inline object
        if (_config.demoData && typeof _config.demoData === 'object') {
            self._data = _config.demoData;
            self._loaded = true;
            return Promise.resolve(self._data);
        }

        // Source 2: Script tag
        if (_config.demoDataElement && typeof document !== 'undefined') {
            try {
                var el = document.querySelector(_config.demoDataElement);
                if (el && el.textContent) {
                    self._data = JSON.parse(el.textContent);
                    self._loaded = true;
                    return Promise.resolve(self._data);
                }
            } catch (e) {
                console.warn('[FB Demo] Failed to parse demoDataElement:', e);
            }
        }

        // Source 3: URL path
        if (_config.demoDataPath) {
            var basePath = _config.demoDataPath.replace(/\/+$/, '');
            return fetch(basePath + '/data.json').then(function (res) {
                return res.json();
            }).then(function (data) {
                self._data = data;
                self._loaded = true;
                return data;
            }).catch(function () {
                self._data = {};
                self._loaded = true;
                return self._data;
            });
        }

        // No source configured
        self._data = {};
        self._loaded = true;
        return Promise.resolve(self._data);
    };

    /**
     * Find matching demo data for a query. Logic:
     * 1. Check if the SQL matches a <script> tag ID key in demo queries
     * 2. Exact SQL string match
     * 3. Longest substring match
     * 4. Empty array fallback
     * @param {string} sql
     * @returns {Promise<Array>}
     */
    DemoAdapter.prototype._matchQuery = function (sql) {
        return this._ensureLoaded().then(function (data) {
            var queries = (data && data.queries) || {};
            var trimmedSql = (sql || '').trim();

            // 1. Check if SQL text matches the content of a <script> tag, and
            //    that tag's ID is a key in the queries map.
            if (typeof document !== 'undefined') {
                var scripts = document.querySelectorAll('script[type="text/plain"]');
                for (var i = 0; i < scripts.length; i++) {
                    var scriptEl = scripts[i];
                    if (scriptEl.id && scriptEl.textContent.trim() === trimmedSql) {
                        if (queries[scriptEl.id] !== undefined) {
                            return queries[scriptEl.id];
                        }
                    }
                }
            }

            // 2. Exact SQL match
            if (queries[trimmedSql] !== undefined) return queries[trimmedSql];

            // 3. Longest substring match
            var bestKey = null;
            var bestLen = 0;
            var keys = Object.keys(queries);
            for (var j = 0; j < keys.length; j++) {
                var key = keys[j];
                if (trimmedSql.indexOf(key) >= 0 && key.length > bestLen) {
                    bestKey = key;
                    bestLen = key.length;
                }
                if (key.indexOf(trimmedSql) >= 0 && trimmedSql.length > bestLen) {
                    bestKey = key;
                    bestLen = trimmedSql.length;
                }
            }
            if (bestKey !== null) return queries[bestKey];

            // 4. Fallback
            return [];
        });
    };

    DemoAdapter.prototype.runQueryAsync = function (sql) {
        return this._matchQuery(sql);
    };

    DemoAdapter.prototype.restApiCallAsync = function () {
        return this._ensureLoaded().then(function (data) {
            return (data && data.restApi) || { http_code: '200', response: '{}' };
        });
    };

    DemoAdapter.prototype.runApiJSONAsync = function () {
        return this._ensureLoaded().then(function (data) {
            return (data && data.legacyApi) || {};
        });
    };

    DemoAdapter.prototype.runImportCSVAsync = function () {
        return Promise.resolve({ is_error: false, status: 'demo' });
    };

    DemoAdapter.prototype.runImportCSV_JSONAsync = function () {
        return Promise.resolve({ is_error: false, status: 'demo' });
    };

    DemoAdapter.prototype.getCompanyNameAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.user && d.user.companyName) || 'Demo Company'; });
    };

    DemoAdapter.prototype.getUsernameAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.user && d.user.username) || 'demo'; });
    };

    DemoAdapter.prototype.getUserEmailAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.user && d.user.email) || 'demo@example.com'; });
    };

    DemoAdapter.prototype.getUserIdAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.user && d.user.userId) || 1; });
    };

    DemoAdapter.prototype.getUserGroupIdsAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.user && d.user.groups) || []; });
    };

    DemoAdapter.prototype.hasAccessRightAsync = function () {
        return Promise.resolve(true); // Demo always has access
    };

    DemoAdapter.prototype.getPluginNameAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.context && d.context.pluginName) || 'DemoPlugin'; });
    };

    DemoAdapter.prototype.getModuleNameAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.context && d.context.moduleName) || 'DemoModule'; });
    };

    DemoAdapter.prototype.getObjectIdAsync = function () {
        return this._ensureLoaded().then(function (d) { return (d.context && d.context.objectId) || 0; });
    };

    // Plugin Data — in-memory + localStorage for demo
    DemoAdapter.prototype._pluginStore = {};

    DemoAdapter.prototype.getPluginDataAsync = function (group, key) {
        var storeKey = group + '::' + key;
        if (this._pluginStore[storeKey] !== undefined) {
            return Promise.resolve(this._pluginStore[storeKey]);
        }
        if (typeof localStorage !== 'undefined') {
            try {
                var val = localStorage.getItem('fb_demo_' + storeKey);
                if (val !== null) return Promise.resolve(val);
            } catch (e) { /* ignore */ }
        }
        return Promise.resolve(null);
    };

    DemoAdapter.prototype.savePluginDataAsync = function (group, data) {
        var map = typeof data === 'string' ? _safeParse(data) : data;
        if (map && typeof map === 'object') {
            var self = this;
            Object.keys(map).forEach(function (key) {
                var storeKey = group + '::' + key;
                self._pluginStore[storeKey] = map[key];
                if (typeof localStorage !== 'undefined') {
                    try { localStorage.setItem('fb_demo_' + storeKey, map[key]); } catch (e) { /* ignore */ }
                }
            });
        }
        return Promise.resolve(true);
    };

    DemoAdapter.prototype.deletePluginDataAsync = function (group) {
        var self = this;
        Object.keys(self._pluginStore).forEach(function (k) {
            if (k.indexOf(group + '::') === 0) delete self._pluginStore[k];
        });
        if (typeof localStorage !== 'undefined') {
            try {
                var prefix = 'fb_demo_' + group + '::';
                var keys = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(prefix) === 0) keys.push(k);
                }
                keys.forEach(function (k) { localStorage.removeItem(k); });
            } catch (e) { /* ignore */ }
        }
        return Promise.resolve(true);
    };

    // UI — same browser-native as WebAdapter
    DemoAdapter.prototype.dialogStatus = WebAdapter.prototype.dialogStatus;
    DemoAdapter.prototype.pbUpdate = WebAdapter.prototype.pbUpdate;
    DemoAdapter.prototype.dialogClose = WebAdapter.prototype.dialogClose;
    DemoAdapter.prototype.showStatusBar = WebAdapter.prototype.showStatusBar;
    DemoAdapter.prototype.toggleFullscreen = WebAdapter.prototype.toggleFullscreen;
    DemoAdapter.prototype.saveDataToFile = WebAdapter.prototype.saveDataToFile;
    DemoAdapter.prototype.getResourceFileStringAsync = WebAdapter.prototype.getResourceFileStringAsync;
    DemoAdapter.prototype.getResourceFileBase64Async = WebAdapter.prototype.getResourceFileBase64Async;

    // Logging
    DemoAdapter.prototype.logInformation = function (msg) { console.log('[FB Demo] ' + msg); };
    DemoAdapter.prototype.logError = function (msg) { console.error('[FB Demo] ' + msg); };

    // ═══════════════════════════════════════════════════════════════════
    // [9] Timezone Utilities (pure JS, works everywhere)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Format current time for a given timezone as "yyyy-MM-dd HH:mm:ss".
     * @param {string} tz - IANA timezone ID (e.g., "America/Los_Angeles") or abbreviation.
     * @returns {string}
     */
    function _tzGetTimeForServer(tz) {
        try {
            var now = new Date();
            var parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            }).formatToParts(now);

            var map = {};
            parts.forEach(function (p) { map[p.type] = p.value; });
            return map.year + '-' + map.month + '-' + map.day + ' ' +
                   map.hour + ':' + map.minute + ':' + map.second;
        } catch (e) {
            // Fallback: return local time formatted
            var d = new Date();
            return d.getFullYear() + '-' +
                   String(d.getMonth() + 1).padStart(2, '0') + '-' +
                   String(d.getDate()).padStart(2, '0') + ' ' +
                   String(d.getHours()).padStart(2, '0') + ':' +
                   String(d.getMinutes()).padStart(2, '0') + ':' +
                   String(d.getSeconds()).padStart(2, '0');
        }
    }

    /**
     * Convert a server datetime string to the client's local timezone.
     * @param {string} serverDatetimeStr - "yyyy-MM-dd HH:mm:ss"
     * @param {string} serverTz - Server timezone ID.
     * @returns {string} Local datetime string "yyyy-MM-dd HH:mm:ss".
     */
    function _tzConvertServerToClient(serverDatetimeStr, serverTz) {
        try {
            // Parse server datetime as if in the server timezone
            var isoStr = serverDatetimeStr.replace(' ', 'T');
            // Build a date in UTC, then adjust for server tz offset
            var serverDate = new Date(isoStr);

            // Get UTC offset for server timezone at that time
            var serverFormatted = new Intl.DateTimeFormat('en-CA', {
                timeZone: serverTz,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            }).format(serverDate);

            // Parse the formatted date to get what the server thinks this time is
            // Then calculate the offset
            var localStr = serverFormatted.replace(',', '');
            // The approach: treat input as server local time, convert to UTC, then to local
            // Create date using timezone interpretation
            var utcMs = _parseDateInTz(serverDatetimeStr, serverTz);

            var localDate = new Date(utcMs);
            return localDate.getFullYear() + '-' +
                   String(localDate.getMonth() + 1).padStart(2, '0') + '-' +
                   String(localDate.getDate()).padStart(2, '0') + ' ' +
                   String(localDate.getHours()).padStart(2, '0') + ':' +
                   String(localDate.getMinutes()).padStart(2, '0') + ':' +
                   String(localDate.getSeconds()).padStart(2, '0');
        } catch (e) {
            return serverDatetimeStr;
        }
    }

    /**
     * Convert a client local datetime to the server timezone.
     * @param {string} clientDatetimeStr - "yyyy-MM-dd HH:mm:ss" in local time.
     * @param {string} serverTz - Server timezone ID.
     * @returns {string} Server datetime string "yyyy-MM-dd HH:mm:ss".
     */
    function _tzConvertClientToServer(clientDatetimeStr, serverTz) {
        try {
            // Parse client datetime as local time
            var parts = clientDatetimeStr.split(/[- :]/);
            var localDate = new Date(
                parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]),
                parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5])
            );

            // Format to server timezone
            var tz_parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: serverTz,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            }).formatToParts(localDate);

            var map = {};
            tz_parts.forEach(function (p) { map[p.type] = p.value; });
            return map.year + '-' + map.month + '-' + map.day + ' ' +
                   map.hour + ':' + map.minute + ':' + map.second;
        } catch (e) {
            return clientDatetimeStr;
        }
    }

    /**
     * Parse a "yyyy-MM-dd HH:mm:ss" string as if it were in the given timezone.
     * Returns UTC milliseconds.
     * @param {string} dtStr
     * @param {string} tz
     * @returns {number}
     */
    function _parseDateInTz(dtStr, tz) {
        // Strategy: binary-search the UTC offset by comparing formatted output
        var parts = dtStr.split(/[- :]/);
        var y = parseInt(parts[0]), mo = parseInt(parts[1]) - 1, d = parseInt(parts[2]);
        var h = parseInt(parts[3]), mi = parseInt(parts[4]), s = parseInt(parts[5]);

        // Initial guess: treat as UTC
        var guess = Date.UTC(y, mo, d, h, mi, s);

        // Format guess in target tz and see what we get
        var formatted = _tzGetTimeAtMs(guess, tz);
        var fParts = formatted.split(/[- :]/);
        var fy = parseInt(fParts[0]), fmo = parseInt(fParts[1]) - 1, fd = parseInt(fParts[2]);
        var fh = parseInt(fParts[3]), fmi = parseInt(fParts[4]), fs = parseInt(fParts[5]);
        var fMs = Date.UTC(fy, fmo, fd, fh, fmi, fs);

        // The difference tells us the tz offset
        var diff = fMs - guess;
        return guess - diff;
    }

    /**
     * Format a UTC timestamp in a specific timezone.
     * @param {number} ms - UTC milliseconds.
     * @param {string} tz - Timezone ID.
     * @returns {string} "yyyy-MM-dd HH:mm:ss"
     */
    function _tzGetTimeAtMs(ms, tz) {
        var d = new Date(ms);
        var p = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).formatToParts(d);

        var map = {};
        p.forEach(function (part) { map[part.type] = part.value; });
        return map.year + '-' + map.month + '-' + map.day + ' ' +
               map.hour + ':' + map.minute + ':' + map.second;
    }

    // ═══════════════════════════════════════════════════════════════════
    // [8] FB Facade — Public API
    // ═══════════════════════════════════════════════════════════════════

    var _adapter = null;
    var _initialized = false;
    var _environment = null;
    var _bridgeVersion = null;

    /** Detect the current environment and instantiate the adapter. */
    function _detectEnvironment() {
        // If already initialized, skip
        if (_initialized) return;

        // 1. Check for fb_client
        if (typeof window !== 'undefined' && window.fb_client &&
            typeof window.fb_client.runQuery === 'function') {
            _environment = 'jxbrowser';
            _adapter = new JXBrowserAdapter();
            // Detect bridge version: 2024 has getTimeForServer
            _bridgeVersion = _hasBridgeMethod(window.fb_client, 'getTimeForServer') ? '2024' : '2025';
            _initialized = true;
            return;
        }

        // 2. Explicit environment from configure()
        if (_config.environment !== 'auto') {
            _environment = _config.environment;
            if (_environment === 'jxbrowser') {
                _adapter = new JXBrowserAdapter();
                _bridgeVersion = typeof window !== 'undefined' && window.fb_client &&
                    _hasBridgeMethod(window.fb_client, 'getTimeForServer') ? '2024' : '2025';
            } else if (_environment === 'web') {
                _adapter = new WebAdapter();
            } else {
                _environment = 'demo';
                _adapter = new DemoAdapter();
            }
            _initialized = true;
            return;
        }

        // 3. If apiBaseUrl is configured and we're in a browser, assume web
        if (_config.apiBaseUrl && _config.apiBaseUrl !== '/api/fb') {
            _environment = 'web';
            _adapter = new WebAdapter();
            _initialized = true;
            return;
        }

        // 4. Default to demo
        _environment = 'demo';
        _adapter = new DemoAdapter();
        _initialized = true;
    }

    /** Ensure initialization has occurred. */
    function _ensureInit() {
        if (!_initialized) _detectEnvironment();
    }

    // ── The FB object ──────────────────────────────────────────────

    var FB = {
        version: '1.0.0',

        /** Error constructors exposed on FB for instanceof checks. */
        FBError: FBError,
        PlatformError: PlatformError,
        QueryError: QueryError,
        ApiError: ApiError
    };

    // -- Properties (use defineProperty for getters) --

    Object.defineProperty(FB, 'environment', {
        get: function () { _ensureInit(); return _environment; },
        enumerable: true
    });

    Object.defineProperty(FB, 'isJXBrowser', {
        get: function () { _ensureInit(); return _environment === 'jxbrowser'; },
        enumerable: true
    });

    Object.defineProperty(FB, 'isWeb', {
        get: function () { _ensureInit(); return _environment === 'web'; },
        enumerable: true
    });

    Object.defineProperty(FB, 'isDemo', {
        get: function () { _ensureInit(); return _environment === 'demo'; },
        enumerable: true
    });

    Object.defineProperty(FB, 'bridgeVersion', {
        get: function () { _ensureInit(); return _bridgeVersion; },
        enumerable: true
    });

    // ── Configuration ──

    /**
     * Configure the FB library. Call before any data methods.
     * @param {object} opts - Configuration options.
     * @param {string} [opts.environment='auto'] - 'jxbrowser'|'web'|'demo'|'auto'
     * @param {string} [opts.apiBaseUrl='/api/fb'] - Base URL for web adapter.
     * @param {object} [opts.demoData] - Inline demo data object.
     * @param {string} [opts.demoDataElement] - CSS selector for <script type="application/json"> tag.
     * @param {string} [opts.demoDataPath] - URL path prefix for fetching demo JSON files.
     * @param {string} [opts.statusElement='#fb-status'] - CSS selector for status text element.
     * @param {string} [opts.progressElement='#fb-progress'] - CSS selector for progress element.
     * @param {string} [opts.onPlatformOnly='warn'] - 'warn'|'silent'|'throw'
     * @param {number} [opts.requestTimeout=30000] - Timeout in ms for web requests.
     */
    FB.configure = function (opts) {
        if (!opts) return;
        Object.keys(opts).forEach(function (key) {
            if (_config.hasOwnProperty(key)) {
                _config[key] = opts[key];
            }
        });
        // Reset initialization so environment detection re-runs
        _initialized = false;
        _adapter = null;
        _environment = null;
        _bridgeVersion = null;
        _detectEnvironment();
    };

    // ═══════════════════════════════════════════════════════════════
    // Data Operations — Sync (JXBrowser only)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Execute a SQL query synchronously. JXBrowser only.
     * @param {string} sql - SQL query string.
     * @param {object} [params] - Query parameters.
     * @returns {Array|object} Parsed result array, or {is_error, error_msg} on failure.
     */
    FB.query = function (sql, params) {
        _ensureInit();
        _syncGuard('query');
        var raw = _adapter.runQuery(sql, params);
        return _parseAndCheck(raw, false, sql);
    };

    /**
     * Execute a SQL query asynchronously. Works on all platforms.
     * @param {string} sql - SQL query string.
     * @param {object} [params] - Query parameters.
     * @returns {Promise<Array>} Resolves with array of row objects. Rejects with QueryError on failure.
     */
    FB.queryAsync = function (sql, params) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                var raw = _adapter.runQuery(sql, params);
                return _parseAndCheck(raw, true, sql);
            });
        }
        return _adapter.runQueryAsync(sql, params).then(function (result) {
            return _parseAndCheck(result, true, sql);
        });
    };

    /**
     * Call the Fishbowl REST API synchronously. JXBrowser only.
     * @param {string} method - HTTP method (GET, POST, PUT, DELETE).
     * @param {string} path - API endpoint path.
     * @param {string} [body] - JSON request body.
     * @returns {object} {http_code, response} or {is_error, error_msg}.
     */
    FB.restApi = function (method, path, body) {
        _ensureInit();
        _syncGuard('restApi');
        var raw = _adapter.restApiCall(method, path, body || null);
        return _parseAndCheck(raw, false);
    };

    /**
     * Call the Fishbowl REST API asynchronously. Works on all platforms.
     * @param {string} method - HTTP method.
     * @param {string} path - API endpoint path.
     * @param {string} [body] - JSON request body.
     * @returns {Promise<object>} Resolves with {http_code, response}. Rejects with ApiError on failure.
     */
    FB.restApiAsync = function (method, path, body) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                var raw = _adapter.restApiCall(method, path, body || null);
                return _parseAndCheck(raw, true);
            });
        }
        return _adapter.restApiCallAsync(method, path, body).then(function (result) {
            return _parseAndCheck(result, true);
        });
    };

    /**
     * Call the legacy Fishbowl API synchronously. JXBrowser only.
     * Accepts either (type, payload) or a self-describing request object with _type.
     * @param {string|object} typeOrRq - ApiCallType string or request object with _type.
     * @param {string} [payload] - JSON payload string (when typeOrRq is a string).
     * @returns {object} Parsed response.
     */
    FB.legacyApi = function (typeOrRq, payload) {
        _ensureInit();
        _syncGuard('legacyApi');
        var type, str;
        if (typeOrRq && typeof typeOrRq === 'object' && typeOrRq._type) {
            type = typeOrRq._type;
            str = JSON.stringify(typeOrRq);
        } else {
            type = typeOrRq;
            str = payload;
        }
        var raw = _adapter.runApiJSON(type, str);
        return _parseAndCheck(raw, false);
    };

    /**
     * Call the legacy Fishbowl API asynchronously. Works on all platforms.
     * Accepts either (type, payload) or a self-describing request object with _type.
     * @param {string|object} typeOrRq - ApiCallType string or request object with _type.
     * @param {string} [payload] - JSON payload string (when typeOrRq is a string).
     * @returns {Promise<object>} Parsed response.
     */
    FB.legacyApiAsync = function (typeOrRq, payload) {
        _ensureInit();
        var type, str;
        if (typeOrRq && typeof typeOrRq === 'object' && typeOrRq._type) {
            type = typeOrRq._type;
            str = JSON.stringify(typeOrRq);
        } else {
            type = typeOrRq;
            str = payload;
        }
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                var raw = _adapter.runApiJSON(type, str);
                return _parseAndCheck(raw, true);
            });
        }
        return _adapter.runApiJSONAsync(type, str).then(function (result) {
            return _parseAndCheck(result, true);
        });
    };

    /**
     * Import CSV data synchronously. JXBrowser only.
     * @param {string} type - Import type (e.g., "Part").
     * @param {string} csv - CSV data string.
     * @returns {object} Parsed result.
     */
    FB.importCSV = function (type, csv) {
        _ensureInit();
        _syncGuard('importCSV');
        var raw = _adapter.runImportCSV(type, csv);
        return _parseAndCheck(raw, false);
    };

    /** @param {string} type  @param {string} csv  @returns {Promise<object>} */
    FB.importCSVAsync = function (type, csv) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                var raw = _adapter.runImportCSV(type, csv);
                return _parseAndCheck(raw, true);
            });
        }
        return _adapter.runImportCSVAsync(type, csv).then(function (result) {
            return _parseAndCheck(result, true);
        });
    };

    /**
     * Import CSV from JSON array of row strings synchronously. JXBrowser only.
     * @param {string} type - Import type.
     * @param {string} json - JSON array of CSV row strings.
     * @returns {object} Parsed result.
     */
    FB.importCSVFromJSON = function (type, json) {
        _ensureInit();
        _syncGuard('importCSVFromJSON');
        var raw = _adapter.runImportCSV_JSON(type, json);
        return _parseAndCheck(raw, false);
    };

    /** @param {string} type  @param {string} json  @returns {Promise<object>} */
    FB.importCSVFromJSONAsync = function (type, json) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                var raw = _adapter.runImportCSV_JSON(type, json);
                return _parseAndCheck(raw, true);
            });
        }
        return _adapter.runImportCSV_JSONAsync(type, json).then(function (result) {
            return _parseAndCheck(result, true);
        });
    };

    // ═══════════════════════════════════════════════════════════════
    // User & Context — Sync (JXBrowser only) + Async (all platforms)
    // ═══════════════════════════════════════════════════════════════

    // Helper to generate sync+async pairs for simple getter methods
    function _defineSimpleGetter(fbName, jxMethod, asyncAdapterMethod) {
        FB[fbName] = function () {
            _ensureInit();
            _syncGuard(fbName);
            return _adapter[jxMethod]();
        };
        FB[fbName + 'Async'] = function () {
            _ensureInit();
            if (_adapter instanceof JXBrowserAdapter) {
                return Promise.resolve().then(function () { return _adapter[jxMethod](); });
            }
            return _adapter[asyncAdapterMethod || (fbName + 'Async')]();
        };
    }

    _defineSimpleGetter('getCompanyName', 'getCompanyName', 'getCompanyNameAsync');
    _defineSimpleGetter('getUsername', 'getUsername', 'getUsernameAsync');
    _defineSimpleGetter('getUserEmail', 'getUserEmail', 'getUserEmailAsync');
    _defineSimpleGetter('getUserId', 'getUserId', 'getUserIdAsync');
    _defineSimpleGetter('getUserGroupIds', 'getUserGroupIds', 'getUserGroupIdsAsync');
    _defineSimpleGetter('getPluginName', 'getPluginName', 'getPluginNameAsync');
    _defineSimpleGetter('getModuleName', 'getModuleName', 'getModuleNameAsync');
    _defineSimpleGetter('getObjectId', 'getObjectId', 'getObjectIdAsync');

    /**
     * Check if user has an access right. Sync, JXBrowser only.
     * @param {string} name - Access right name.
     * @returns {boolean}
     */
    FB.hasAccessRight = function (name) {
        _ensureInit();
        _syncGuard('hasAccessRight');
        return _adapter.hasAccessRight(name);
    };

    /**
     * Check if user has an access right. Async, all platforms.
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    FB.hasAccessRightAsync = function (name) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () { return _adapter.hasAccessRight(name); });
        }
        return _adapter.hasAccessRightAsync(name);
    };

    // ═══════════════════════════════════════════════════════════════
    // Plugin Data — Sync + Async
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get plugin data by group and key. Sync, JXBrowser only.
     * @param {string} group  @param {string} key  @returns {string}
     */
    FB.getPluginData = function (group, key) {
        _ensureInit();
        _syncGuard('getPluginData');
        return _adapter.getPluginData(group, key);
    };

    /**
     * Get plugin data by group and key. Async, all platforms.
     * @param {string} group  @param {string} key  @returns {Promise<string>}
     */
    FB.getPluginDataAsync = function (group, key) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () { return _adapter.getPluginData(group, key); });
        }
        return _adapter.getPluginDataAsync(group, key);
    };

    /**
     * Save plugin data for a group. Sync, JXBrowser only.
     * @param {string} group - Group name.
     * @param {object|string} data - Key-value map or JSON string.
     * @returns {boolean}
     */
    FB.savePluginData = function (group, data) {
        _ensureInit();
        _syncGuard('savePluginData');
        return _adapter.savePluginData(group, data);
    };

    /**
     * Save plugin data for a group. Async, all platforms.
     * @param {string} group  @param {object|string} data  @returns {Promise<boolean>}
     */
    FB.savePluginDataAsync = function (group, data) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () { return _adapter.savePluginData(group, data); });
        }
        return _adapter.savePluginDataAsync(group, data);
    };

    /**
     * Delete all plugin data for a group. Sync, JXBrowser only.
     * @param {string} group  @returns {boolean}
     */
    FB.deletePluginData = function (group) {
        _ensureInit();
        _syncGuard('deletePluginData');
        return _adapter.deletePluginData(group);
    };

    /**
     * Delete all plugin data for a group. Async, all platforms.
     * @param {string} group  @returns {Promise<boolean>}
     */
    FB.deletePluginDataAsync = function (group) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () { return _adapter.deletePluginData(group); });
        }
        return _adapter.deletePluginDataAsync(group);
    };

    // ═══════════════════════════════════════════════════════════════
    // UI Operations — Work everywhere (adapted per platform)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Set the status message. Updates JXBrowser dialog + DOM element.
     * @param {string} msg
     */
    FB.setStatus = function (msg) {
        _ensureInit();
        _adapter.dialogStatus(msg);
        // Always update DOM too (even in JXBrowser, for pages that have a status element)
        if (!(_adapter instanceof JXBrowserAdapter)) return;
        _setDomText(_config.statusElement, msg);
    };

    /**
     * Set progress bar value. Updates JXBrowser dialog + DOM element.
     * @param {number} value - 0–100 or -1 for indeterminate.
     */
    FB.setProgress = function (value) {
        _ensureInit();
        _adapter.pbUpdate(value);
        if (!(_adapter instanceof JXBrowserAdapter)) return;
        _setDomProgress(_config.progressElement, value);
    };

    /**
     * Close the current dialog/window.
     * @returns {boolean}
     */
    FB.closeDialog = function () {
        _ensureInit();
        return _adapter.dialogClose();
    };

    /**
     * Show or hide the status bar.
     * @param {boolean} show
     */
    FB.showStatusBar = function (show) {
        _ensureInit();
        _adapter.showStatusBar(show);
    };

    /**
     * Toggle fullscreen mode.
     */
    FB.toggleFullscreen = function () {
        _ensureInit();
        _adapter.toggleFullscreen();
    };

    /**
     * Save data to a file. JXBrowser shows a save dialog; web triggers a download.
     * @param {string} title - Dialog title.
     * @param {string} ext - File extension (e.g., "pdf").
     * @param {string} desc - Extension description (e.g., "PDF Files").
     * @param {string} b64 - Base64 encoded data.
     * @param {string} [name] - Default filename.
     * @param {boolean} [open] - Open file after saving (JXBrowser only).
     */
    FB.saveFile = function (title, ext, desc, b64, name, open) {
        _ensureInit();
        _adapter.saveDataToFile(title, ext, desc, b64, name, open);
    };

    /**
     * Get a resource file as a string. Async, all platforms.
     * JXBrowser reads from working directory; web/demo fetches via HTTP.
     * @param {string} path - Relative file path.
     * @returns {Promise<string>}
     */
    FB.getResourceFileAsync = function (path) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                return _adapter.getResourceFileString(path);
            });
        }
        return _adapter.getResourceFileStringAsync(path);
    };

    /**
     * Get a resource file as base64. Async, all platforms.
     * @param {string} path - Relative file path.
     * @returns {Promise<string>}
     */
    FB.getResourceFileBase64Async = function (path) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return Promise.resolve().then(function () {
                return _adapter.getResourceFileBase64(path);
            });
        }
        return _adapter.getResourceFileBase64Async(path);
    };

    // ═══════════════════════════════════════════════════════════════
    // Platform-Only Operations (JXBrowser only — warn/no-op elsewhere)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Navigate to a Fishbowl module. JXBrowser only.
     * @param {string} module - Module name (e.g., "SalesOrder").
     * @param {string} param - Parameter (usually an ID).
     */
    FB.hyperLink = function (module, param) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) {
            _platformWarn('hyperLink');
            return;
        }
        _adapter.hyperLink(module, param);
    };

    /** Reload the current object in the parent module. JXBrowser only. */
    FB.reloadObject = function () {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('reloadObject');
        return _adapter.reloadObject();
    };

    /**
     * Run a scheduled task by name. JXBrowser only.
     * @param {string} name
     */
    FB.runScheduledTask = function (name) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('runScheduledTask');
        _adapter.runScheduledTask(name);
    };

    /**
     * Preview a report in a popup window. JXBrowser only.
     * @param {string|number} id - Report ID.
     * @param {string|object} params - Report parameters (JSON string or object).
     */
    FB.previewReport = function (id, params) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('previewReport');
        var p = typeof params === 'string' ? params : JSON.stringify(params || {});
        _adapter.previewReport(id, p);
    };

    /**
     * Generate a report PDF. JXBrowser only.
     * @param {string|number} id - Report ID.
     * @param {string|object} params - Report parameters.
     * @param {boolean} [throwException=false]
     * @returns {object} {is_error, pdf_bytes} or {is_error, message}
     */
    FB.getReportPDF = function (id, params, throwException) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('getReportPDF');
        var p = typeof params === 'string' ? params : JSON.stringify(params || {});
        return _parseAndCheck(_adapter.getReportPDF(id, p, throwException), false);
    };

    /**
     * Generate merged reports PDF. JXBrowser only.
     * @param {string|Array} dict - Report dictionary JSON or array.
     * @returns {string} Base64 encoded PDF.
     */
    FB.getMergedReportsPDF = function (dict) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('getMergedReportsPDF');
        var d = typeof dict === 'string' ? dict : JSON.stringify(dict);
        return _adapter.getMergedReportsPDF(d);
    };

    /**
     * Get list of local printers. JXBrowser only.
     * @returns {object} {printers: string[]}
     */
    FB.localPrinters = function () {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('localPrinters');
        return _parseAndCheck(_adapter.localPrinters(), false);
    };

    /**
     * Print a PDF to a printer. JXBrowser only.
     * @param {string} printer - Printer name.
     * @param {string} b64 - Base64 encoded PDF.
     * @param {boolean} [dialog=false] - Show print dialog.
     */
    FB.printPDF = function (printer, b64, dialog) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('printPDF');
        _adapter.printPDF(printer, b64, dialog);
    };

    /**
     * Print a report PDF directly. JXBrowser only.
     * @param {string} printer  @param {number} copies  @param {string|number} id
     * @param {string|object} params  @param {boolean} [throwException]
     */
    FB.printReportPDF = function (printer, copies, id, params, throwException) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('printReportPDF');
        var p = typeof params === 'string' ? params : JSON.stringify(params || {});
        _adapter.printReportPDF(printer, copies, id, p, throwException);
    };

    /**
     * Print merged reports PDF. JXBrowser only.
     * @param {string} printer  @param {number} copies  @param {string|Array} dict
     */
    FB.printMergedReportsPDF = function (printer, copies, dict) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('printMergedReportsPDF');
        var d = typeof dict === 'string' ? dict : JSON.stringify(dict);
        _adapter.printMergedReportsPDF(printer, copies, d);
    };

    /**
     * Print multiple reports via JasperReports. JXBrowser only.
     * @param {string|Array} dict  @param {string} printer
     */
    FB.printMultipleReports = function (dict, printer) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('printMultipleReports');
        var d = typeof dict === 'string' ? dict : JSON.stringify(dict);
        _adapter.printMultipleReports(d, printer);
    };

    /**
     * Print a ZPL document to a label printer. JXBrowser only.
     * @param {string} printer  @param {string} zpl
     */
    FB.printZPL = function (printer, zpl) {
        _ensureInit();
        if (!(_adapter instanceof JXBrowserAdapter)) return _platformWarn('printZPL');
        _adapter.printZPL(printer, zpl);
    };

    // ═══════════════════════════════════════════════════════════════
    // Logging — Works everywhere
    // ═══════════════════════════════════════════════════════════════

    /**
     * Log an informational message.
     * @param {string} msg
     */
    FB.log = function (msg) {
        _ensureInit();
        console.log('[FB] ' + msg);
        _logBuffer.push({ level: 'INFO', msg: msg, ts: new Date().toISOString() });
        if (_adapter instanceof JXBrowserAdapter) {
            _adapter.logInformation(msg);
        } else if (_adapter instanceof WebAdapter) {
            _adapter.logInformation(msg);
            _adapter.logAsync('INFO', msg);
        } else {
            _adapter.logInformation(msg);
        }
    };

    /**
     * Log an error message.
     * @param {string} msg
     */
    FB.logError = function (msg) {
        _ensureInit();
        console.error('[FB] ' + msg);
        _logBuffer.push({ level: 'ERROR', msg: msg, ts: new Date().toISOString() });
        if (_adapter instanceof JXBrowserAdapter) {
            _adapter.logError(msg);
        } else if (_adapter instanceof WebAdapter) {
            _adapter.logError(msg);
            _adapter.logAsync('ERROR', msg);
        } else {
            _adapter.logError(msg);
        }
    };

    /**
     * Get all collected log messages.
     * In JXBrowser, returns the bridge's log buffer. Otherwise returns the internal buffer.
     * @returns {string}
     */
    FB.logMessages = function () {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return _adapter.logMessages();
        }
        return _logBuffer.map(function (entry) {
            return entry.ts + ' [' + entry.level + '] ' + entry.msg;
        }).join('\n');
    };

    // ═══════════════════════════════════════════════════════════════
    // [9] Timezone — Pure JS, works everywhere
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get current time formatted for the server's timezone.
     * On JXBrowser 2024, may delegate to Java for extra accuracy.
     * @param {string} tz - Server timezone ID (e.g., "America/Los_Angeles", "PST").
     * @returns {string} "yyyy-MM-dd HH:mm:ss"
     */
    FB.getTimeForServer = function (tz) {
        _ensureInit();
        if (_adapter instanceof JXBrowserAdapter) {
            return _adapter.getTimeForServer(tz);
        }
        return _tzGetTimeForServer(tz);
    };

    /**
     * Convert a datetime string from server timezone to client local time.
     * @param {string} serverDatetimeStr - "yyyy-MM-dd HH:mm:ss" from the server.
     * @param {string} serverTz - Server timezone ID.
     * @returns {string} "yyyy-MM-dd HH:mm:ss" in client local time.
     */
    FB.convertServerTimeToClient = function (serverDatetimeStr, serverTz) {
        _ensureInit();
        return _tzConvertServerToClient(serverDatetimeStr, serverTz);
    };

    /**
     * Convert a client local datetime to server timezone.
     * @param {string} clientDatetimeStr - "yyyy-MM-dd HH:mm:ss" in local time.
     * @param {string} serverTz - Server timezone ID.
     * @returns {string} "yyyy-MM-dd HH:mm:ss" in server timezone.
     */
    FB.convertClientTimeToServer = function (clientDatetimeStr, serverTz) {
        _ensureInit();
        return _tzConvertClientToServer(clientDatetimeStr, serverTz);
    };

    // ═══════════════════════════════════════════════════════════════
    // [10] Compat Shim — FB.compat() installs global helpers
    // ═══════════════════════════════════════════════════════════════

    /**
     * Install backward-compatible global functions that existing CloudPages expect.
     * After calling FB.compat(), the following globals are available:
     *   fb_query(sql, params) → FB.query(sql, params)
     *   setStatus(msg)        → FB.setStatus(msg)
     *   setProgress(val)      → FB.setProgress(val)
     */
    FB.compat = function () {
        _ensureInit();
        var g = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};

        g.fb_query = function (sql, params) {
            return FB.query(sql, params);
        };

        g.setStatus = function (msg) {
            FB.setStatus(msg);
        };

        g.setProgress = function (val) {
            FB.setProgress(val);
        };

        // Provide a getSQL helper that reads <script> tag content by ID
        if (!g.getSQL) {
            g.getSQL = function (id) {
                var el = typeof document !== 'undefined' ? document.getElementById(id) : null;
                return el ? el.textContent.trim() : '';
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // Developer — listMethods
    // ═══════════════════════════════════════════════════════════════

    /**
     * List all available FB methods for the current environment.
     * @returns {string[]}
     */
    FB.listMethods = function () {
        _ensureInit();
        var methods = [];
        var allMethods = [
            // Data - sync
            'query', 'restApi', 'legacyApi', 'importCSV', 'importCSVFromJSON',
            // Data - async
            'queryAsync', 'restApiAsync', 'legacyApiAsync', 'importCSVAsync', 'importCSVFromJSONAsync',
            // User/Context - sync
            'getCompanyName', 'getUsername', 'getUserEmail', 'getUserId',
            'getUserGroupIds', 'hasAccessRight', 'getPluginName', 'getModuleName', 'getObjectId',
            // User/Context - async
            'getCompanyNameAsync', 'getUsernameAsync', 'getUserEmailAsync', 'getUserIdAsync',
            'getUserGroupIdsAsync', 'hasAccessRightAsync', 'getPluginNameAsync', 'getModuleNameAsync', 'getObjectIdAsync',
            // Plugin Data
            'getPluginData', 'savePluginData', 'deletePluginData',
            'getPluginDataAsync', 'savePluginDataAsync', 'deletePluginDataAsync',
            // UI
            'setStatus', 'setProgress', 'closeDialog', 'showStatusBar', 'toggleFullscreen',
            'saveFile', 'getResourceFileAsync', 'getResourceFileBase64Async',
            // Platform-only
            'hyperLink', 'reloadObject', 'runScheduledTask', 'previewReport',
            'getReportPDF', 'getMergedReportsPDF', 'localPrinters',
            'printPDF', 'printReportPDF', 'printMergedReportsPDF', 'printMultipleReports', 'printZPL',
            // Logging
            'log', 'logError', 'logMessages',
            // Timezone
            'getTimeForServer', 'convertServerTimeToClient', 'convertClientTimeToServer',
            // Developer
            'listMethods',
            // Config
            'configure', 'compat'
        ];

        var syncOnly = [
            'query', 'restApi', 'legacyApi', 'importCSV', 'importCSVFromJSON',
            'getCompanyName', 'getUsername', 'getUserEmail', 'getUserId',
            'getUserGroupIds', 'hasAccessRight', 'getPluginName', 'getModuleName', 'getObjectId',
            'getPluginData', 'savePluginData', 'deletePluginData'
        ];

        var platformOnly = [
            'hyperLink', 'reloadObject', 'runScheduledTask', 'previewReport',
            'getReportPDF', 'getMergedReportsPDF', 'localPrinters',
            'printPDF', 'printReportPDF', 'printMergedReportsPDF', 'printMultipleReports', 'printZPL'
        ];

        allMethods.forEach(function (name) {
            var available = true;
            var note = '';

            if (syncOnly.indexOf(name) >= 0 && _environment !== 'jxbrowser') {
                available = false;
                note = ' (JXBrowser only - use ' + name + 'Async)';
            }

            if (platformOnly.indexOf(name) >= 0 && _environment !== 'jxbrowser') {
                available = false;
                note = ' (JXBrowser only)';
            }

            methods.push(name + (available ? '' : note));
        });

        return methods;
    };

    // ═══════════════════════════════════════════════════════════════
    // Auto-detect on load
    // ═══════════════════════════════════════════════════════════════

    _detectEnvironment();

    return FB;

}));
