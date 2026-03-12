/**
 * fishbowl.js — Fishbowl ERP Import CSV & JSON Envelope Library
 *
 * Two namespaces:
 *   FishbowlCSV  — CSV generation for all 56 Fishbowl import types
 *   FishbowlJSON — API envelope / request building
 *
 * UMD export: window.FishbowlCSV + window.FishbowlJSON, CommonJS, AMD
 * No build tooling required — single <script> include.
 *
 * Column definitions sourced from Fishbowl Java server (fbcore-26.1).
 */
(function (root, factory) {
    'use strict';
    var result = factory();
    if (typeof define === 'function' && define.amd) {
        define(function () { return result; });
    } else if (typeof module === 'object' && module.exports) {
        module.exports = result;
    } else {
        root.FishbowlCSV = result.FishbowlCSV;
        root.FishbowlJSON = result.FishbowlJSON;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    // Section 1: CsvBuilder
    // =========================================================================

    class CsvBuilder {
        constructor() {
            this._headers = null;
            this._rows = [];
            this._rawLines = [];
        }

        header(columns) {
            this._headers = columns.slice();
            return this;
        }

        row(values) {
            this._rows.push(values.map(CsvBuilder.escape));
            return this;
        }

        rawLine(text) {
            this._rawLines.push(text);
            return this;
        }

        build() {
            var lines = [];
            if (this._headers) {
                lines.push(this._headers.map(CsvBuilder.escape).join(','));
            }
            for (var i = 0; i < this._rows.length; i++) {
                lines.push(this._rows[i].join(','));
            }
            for (var j = 0; j < this._rawLines.length; j++) {
                lines.push(this._rawLines[j]);
            }
            return lines.join('\r\n') + '\r\n';
        }

        static escape(value) {
            if (value === null || value === undefined) return '""';
            var s = String(value);
            if (s === '') return '""';
            if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 ||
                s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }
    }

    // =========================================================================
    // Section 2: Import Class
    // =========================================================================

    class Import {
        constructor(schema, data) {
            this.schema = schema;
            this.data = data;
        }

        toCSV() {
            switch (this.schema.structure) {
                case 'hierarchical': return this._buildHierarchical();
                case 'tracking':    return this._buildTracking();
                default:            return this._buildSimple();
            }
        }

        toRows() {
            var csv = this.toCSV();
            // Split on CRLF, trim trailing empty
            var rows = csv.split('\r\n');
            if (rows.length > 0 && rows[rows.length - 1] === '') {
                rows.pop();
            }
            return rows;
        }

        toImportRq() {
            return FishbowlJSON.importRq(this.schema.importType, this.toRows());
        }

        toFbiJson(ticket) {
            return FishbowlJSON.envelope('ImportRq', this.toImportRq(), ticket);
        }

        // --- Simple structure ---
        _buildSimple() {
            var schema = this.schema;
            var data = this.data;
            var columns = schema.columns.slice();
            var dynamicKeys = this._collectDynamicKeys(data, schema.dynamicFields);
            var dynamicColumns = this._buildDynamicColumns(dynamicKeys, schema.dynamicFields);
            var allColumns = columns.concat(dynamicColumns);
            var csv = new CsvBuilder();
            csv.header(allColumns);
            var values = this._buildRowValues(data, schema.columns, dynamicKeys, schema.dynamicFields);
            csv.row(values);
            return csv.build();
        }

        // --- Hierarchical structure ---
        _buildHierarchical() {
            var schema = this.schema;
            var data = this.data;
            var headerData = data.header || {};
            var items = data.items || [];

            // Collect dynamic keys across header and all items
            var headerDynKeys = this._collectDynamicKeys(headerData, schema.header.dynamicFields);
            var itemDynKeys = {};
            if (schema.item.dynamicFields) {
                for (var i = 0; i < items.length; i++) {
                    var itemKeys = this._collectDynamicKeys(items[i], schema.item.dynamicFields);
                    for (var prefix in itemKeys) {
                        if (!itemDynKeys[prefix]) itemDynKeys[prefix] = {};
                        var keys = itemKeys[prefix];
                        for (var k = 0; k < keys.length; k++) {
                            itemDynKeys[prefix][keys[k]] = true;
                        }
                    }
                }
                // Convert sets to arrays
                for (var p in itemDynKeys) {
                    itemDynKeys[p] = Object.keys(itemDynKeys[p]);
                }
            }

            var headerDynCols = this._buildDynamicColumns(headerDynKeys, schema.header.dynamicFields);
            var itemDynCols = this._buildDynamicColumns(itemDynKeys, schema.item.dynamicFields);
            var headerColumns = schema.header.columns.concat(headerDynCols);
            var itemColumns = schema.item.columns.concat(itemDynCols);

            var csv = new CsvBuilder();
            // Two header rows
            csv.header(headerColumns);
            csv.row(itemColumns.map(function (c) { return c; }));

            // Header data row
            var headerValues = this._buildRowValues(headerData, schema.header.columns, headerDynKeys, schema.header.dynamicFields);
            // Set the flag column
            headerValues[0] = schema.header.flag;
            csv.row(headerValues);

            // Item rows
            for (var j = 0; j < items.length; j++) {
                var itemValues = this._buildRowValues(items[j], schema.item.columns, itemDynKeys, schema.item.dynamicFields);
                itemValues[0] = schema.item.flag;
                csv.row(itemValues);
            }

            return csv.build();
        }

        // --- Tracking structure ---
        _buildTracking() {
            var schema = this.schema;
            var data = this.data;
            var columns = schema.columns.slice();

            // Tracking columns
            var trackingKeys = [];
            if (data.tracking) {
                trackingKeys = Object.keys(data.tracking);
            }
            var trackingColumns = trackingKeys.map(function (k) {
                return (schema.trackingPrefix || 'Tracking-') + k;
            });

            var allColumns = columns.concat(trackingColumns);
            var csv = new CsvBuilder();
            csv.header(allColumns);

            // Data row
            var values = [];
            for (var i = 0; i < schema.columns.length; i++) {
                var col = schema.columns[i];
                values.push(data[col] !== undefined ? data[col] : '');
            }
            // Tracking values
            for (var j = 0; j < trackingKeys.length; j++) {
                values.push(data.tracking[trackingKeys[j]] !== undefined ? data.tracking[trackingKeys[j]] : '');
            }
            csv.row(values);

            // Serial lines
            if (schema.hasSerials && data.serials && data.serials.length > 0) {
                for (var s = 0; s < data.serials.length; s++) {
                    csv.rawLine(data.serials[s]);
                }
            }

            return csv.build();
        }

        // --- Dynamic field helpers ---
        _collectDynamicKeys(data, dynamicFields) {
            var result = {};
            if (!dynamicFields) return result;
            for (var i = 0; i < dynamicFields.length; i++) {
                var df = dynamicFields[i];
                var obj = data[df.prop];
                result[df.prefix] = obj ? Object.keys(obj) : [];
            }
            return result;
        }

        _buildDynamicColumns(dynKeys, dynamicFields) {
            var cols = [];
            if (!dynamicFields) return cols;
            for (var i = 0; i < dynamicFields.length; i++) {
                var df = dynamicFields[i];
                var keys = dynKeys[df.prefix] || [];
                for (var j = 0; j < keys.length; j++) {
                    cols.push(df.prefix + keys[j]);
                }
            }
            return cols;
        }

        _buildRowValues(data, staticColumns, dynKeys, dynamicFields) {
            var values = [];
            for (var i = 0; i < staticColumns.length; i++) {
                var col = staticColumns[i];
                values.push(data[col] !== undefined ? data[col] : '');
            }
            if (dynamicFields) {
                for (var d = 0; d < dynamicFields.length; d++) {
                    var df = dynamicFields[d];
                    var keys = dynKeys[df.prefix] || [];
                    var obj = data[df.prop] || {};
                    for (var k = 0; k < keys.length; k++) {
                        values.push(obj[keys[k]] !== undefined ? obj[keys[k]] : '');
                    }
                }
            }
            return values;
        }
    }

    // =========================================================================
    // Section 3: Sanitize
    // =========================================================================

    var SMART_QUOTE_MAP = {
        '\u201C': '"',   // left double quotation mark
        '\u201D': '"',   // right double quotation mark
        '\u2018': "'",   // left single quotation mark
        '\u2019': "'",   // right single quotation mark
        '\u2013': '-',   // en dash
        '\u2014': '-',   // em dash
        '\u2026': '...', // horizontal ellipsis
        '\u00A0': ' '    // non-breaking space
    };
    var SMART_QUOTE_RE = /[\u201C\u201D\u2018\u2019\u2013\u2014\u2026\u00A0]/g;
    // eslint-disable-next-line no-control-regex
    var CR_RE = /\r/g;
    var NON_ISO_RE = /[^\x00-\xFF]/g;

    function sanitize(str, level) {
        if (typeof str !== 'string') return str;
        // Level A: remove \r
        str = str.replace(CR_RE, '');
        // Level B: smart quotes → straight
        str = str.replace(SMART_QUOTE_RE, function (ch) {
            return SMART_QUOTE_MAP[ch] || ch;
        });
        // Level C: strip non-ISO-8859-1
        if (level === 'iso88591') {
            str = str.replace(NON_ISO_RE, '');
        }
        return str;
    }

    // =========================================================================
    // Section 4: FishbowlJSON Namespace
    // =========================================================================

    var FishbowlJSON = {
        importRq: function (type, rowsOrCsv) {
            var rows;
            if (typeof rowsOrCsv === 'string') {
                rows = rowsOrCsv.split('\r\n');
                if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
            } else {
                rows = rowsOrCsv;
            }
            return { Type: type, Rows: { Row: rows } };
        },

        executeQueryRq: function (sql) {
            return { Query: sql };
        },

        importHeaderRq: function (type) {
            return { Type: type };
        },

        issueSORq: function (soNumber) {
            return { SONumber: soNumber };
        },

        quickShipRq: function (soNumber) {
            return { SONumber: soNumber };
        },

        voidSORq: function (soNumber) {
            return { SONumber: soNumber };
        },

        cancelSORq: function (soNumber) {
            return { SONumber: soNumber };
        },

        buildBomRq: function (bomNumber, quantity, locationGroupName) {
            return {
                BomNumber: bomNumber,
                Quantity: quantity,
                LocationGroupName: locationGroupName
            };
        },

        envelope: function (requestType, payload, ticketKey) {
            var msg = {};
            msg[requestType] = payload;
            var env = { FbiJson: { FbiMsgsRq: msg } };
            if (ticketKey) {
                env.FbiJson.Ticket = { Key: ticketKey };
            }
            return env;
        }
    };

    // =========================================================================
    // Section 5: Schema Registry + Factories
    // =========================================================================

    var _schemas = {};

    var FishbowlCSV = {
        CsvBuilder: CsvBuilder,
        Import: Import,
        sanitize: sanitize,

        create: function (importType, data) {
            var schema = _schemas[importType];
            if (!schema) throw new Error('Unknown import type: ' + importType);
            return new Import(schema, data);
        },

        listTypes: function () {
            return Object.keys(_schemas).sort();
        },

        getSchema: function (importType) {
            return _schemas[importType] || null;
        },

        getColumns: function (importType) {
            var schema = _schemas[importType];
            if (!schema) return null;
            if (schema.structure === 'hierarchical') {
                return {
                    header: schema.header.columns.slice(),
                    item: schema.item.columns.slice()
                };
            }
            return schema.columns.slice();
        },

        getTemplate: function (importType) {
            var schema = _schemas[importType];
            if (!schema) return null;
            if (schema.structure === 'hierarchical') {
                var hCols = schema.header.columns.map(CsvBuilder.escape).join(',');
                var iCols = schema.item.columns.map(CsvBuilder.escape).join(',');
                return hCols + '\r\n' + iCols + '\r\n';
            }
            return schema.columns.map(CsvBuilder.escape).join(',') + '\r\n';
        }
    };

    function register(schema) {
        _schemas[schema.importType] = schema;
        // Create named factory: FishbowlCSV[schema.name](data)
        FishbowlCSV[schema.name] = function (data) {
            return new Import(schema, data);
        };
    }

    // =========================================================================
    // Section 6: All 56 Import Type Schemas
    // =========================================================================

    // -------------------------------------------------------------------------
    // Accounting (3)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportTaxRates',
        name: 'TaxRates',
        structure: 'simple',
        columns: ['TaxName', 'TaxCode', 'Description', 'TaxType', 'Rate', 'Amount', 'TaxAgencyName', 'DefaultFlag', 'ActiveFlag']
    });

    register({
        importType: 'ImportCurrency',
        name: 'Currency',
        structure: 'simple',
        columns: ['Name', 'Code', 'Active', 'QuickBooksCurrencyRate', 'GlobalCurrencyRate']
    });

    register({
        importType: 'ImportQuickBooksClass',
        name: 'QuickBooksClass',
        structure: 'simple',
        columns: ['Name', 'Active']
    });

    // -------------------------------------------------------------------------
    // General (11)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportCarriers',
        name: 'Carriers',
        structure: 'simple',
        columns: ['Name', 'SCAC', 'Description', 'Active', 'ServiceName', 'ServiceCode', 'ServiceActive']
    });

    register({
        importType: 'ImportCountryAndState',
        name: 'CountryAndState',
        structure: 'simple',
        columns: ['CountryName', 'CountryCode', 'StateName', 'StateCode']
    });

    register({
        importType: 'ImportCustomFieldData',
        name: 'CustomFieldData',
        structure: 'simple',
        columns: ['ModuleName', 'FieldName', 'RecordData', 'Data']
    });

    register({
        importType: 'ImportCustomFieldLists',
        name: 'CustomFieldLists',
        structure: 'simple',
        columns: ['Type', 'Name', 'Description']
    });

    register({
        importType: 'ImportCustomFields',
        name: 'CustomFields',
        structure: 'simple',
        columns: ['FieldName', 'Description', 'Type', 'ModuleName', 'Required', 'SortOrder', 'Active', 'ListName']
    });

    register({
        importType: 'ImportLocations',
        name: 'Locations',
        structure: 'simple',
        columns: ['Location', 'Description', 'Type', 'LocationGroup', 'LocationNum', 'CustomerName', 'Active', 'Available', 'Pickable', 'Receivable', 'SortOrder'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    register({
        importType: 'ImportMemoData',
        name: 'MemoData',
        structure: 'simple',
        columns: ['ModuleName', 'RecordData', 'Memo']
    });

    register({
        importType: 'ImportPaymentTerms',
        name: 'PaymentTerms',
        structure: 'simple',
        columns: ['TermsName', 'TermsType', 'NetDays', 'Discount', 'DiscountDays', 'DueDate', 'NextMonth', 'DiscountDate', 'Default', 'Active']
    });

    register({
        importType: 'ImportUnitOfMeasureConversions',
        name: 'UnitOfMeasureConversions',
        structure: 'simple',
        columns: ['ToUOM', 'FromUOM', 'Description', 'Factor', 'Multiply']
    });

    register({
        importType: 'ImportUnitsOfMeasure',
        name: 'UnitsOfMeasure',
        structure: 'simple',
        columns: ['Name', 'Details', 'Abbrev', 'ReadOnly', 'Active', 'UomTypeID']
    });

    register({
        importType: 'ImportUsers',
        name: 'Users',
        structure: 'simple',
        columns: ['UserName', 'FirstName', 'LastName', 'Initials', 'Active', 'UserGroups', 'DefaultLocGroup', 'LocGroups', 'Email', 'Phone'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    // -------------------------------------------------------------------------
    // Materials — Parts (13)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportPart',
        name: 'Part',
        structure: 'simple',
        columns: ['PartNumber', 'PartDescription', 'PartDetails', 'UOM', 'UPC', 'PartType', 'Active', 'ABCCode', 'Weight', 'WeightUOM', 'Width', 'Height', 'Length', 'SizeUOM', 'ConsumptionRate', 'PrimaryTracking', 'AlertNote', 'PictureUrl', 'Revision', 'POItemType', 'DefaultOutsourcedReturnItem'],
        dynamicFields: [
            { prefix: 'Tracks-', prop: 'tracks' },
            { prefix: 'Next Value-', prop: 'nextValue' },
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    register({
        importType: 'ImportPartCost',
        name: 'PartCost',
        structure: 'simple',
        columns: ['PartNumber', 'PartDescription', 'AveragePartCost']
    });

    register({
        importType: 'ImportPartStandardCost',
        name: 'PartStandardCost',
        structure: 'simple',
        columns: ['PartNumber', 'PartDescription', 'StandardCost']
    });

    register({
        importType: 'ImportPartUnitsOfMeasure',
        name: 'PartUnitsOfMeasure',
        structure: 'simple',
        columns: ['PartNumber', 'UOM']
    });

    register({
        importType: 'ImportPartAndQuantity',
        name: 'PartAndQuantity',
        structure: 'simple',
        columns: ['Number', 'Description', 'UOM', 'Price', 'Vendor', 'Quantity', 'Cost']
    });

    register({
        importType: 'ImportPartAndProductRenaming',
        name: 'PartAndProductRenaming',
        structure: 'simple',
        columns: ['OldPartNum', 'NewPartNum', 'PartActive', 'OldProductNum', 'NewProductNum', 'ProductActive']
    });

    register({
        importType: 'ImportPartProductVendorPricing',
        name: 'PartProductVendorPricing',
        structure: 'simple',
        columns: [
            // Part columns
            'PartNumber', 'PartDescription', 'PartDetails', 'UOM', 'UPC', 'PartTypeID', 'Active',
            'StdCost',
            // (Tracks-* and Next Value-* inserted dynamically)
            'AssetAccount', 'COGSAccount', 'AdjustmentAccount', 'ScrapAccount', 'VarianceAccount',
            'ABCCode', 'Weight', 'WeightUOM', 'Width', 'Height', 'Len', 'SizeUOM',
            'ConsumptionRate', 'PartURL', 'PartRevision',
            // (CF-* for parts inserted dynamically)
            // Product columns
            'ProductNumber', 'ProductDescription', 'ProductDetails', 'Price', 'ProductSKU',
            'ProductUPC', 'ProductActive', 'ProductTaxable', 'ProductSOItemTypeID', 'IncomeAccount',
            'ProductWeight', 'ProductWeightUOM', 'ProductWidth', 'ProductHeight', 'ProductLen', 'ProductSizeUOM',
            // Vendor columns
            'Vendor', 'DefaultVendor', 'VendorPartNumber', 'Cost', 'VendorUOM'
        ],
        dynamicFields: [
            { prefix: 'Tracks-', prop: 'tracks' },
            { prefix: 'Next Value-', prop: 'nextValue' },
            { prefix: 'CF-', prop: 'customFields' },
            { prefix: 'CFP-', prop: 'productCustomFields' }
        ]
    });

    register({
        importType: 'ImportDefaultLocations',
        name: 'DefaultLocations',
        structure: 'simple',
        columns: ['PartNum', 'Location', 'LocationGroup']
    });

    register({
        importType: 'ImportReorderLevels',
        name: 'ReorderLevels',
        structure: 'simple',
        columns: ['PartNumber', 'Description', 'LocationGroup', 'ReorderPoint', 'OrderUpToLevel']
    });

    register({
        importType: 'ImportAssociatedPricing',
        name: 'AssociatedPricing',
        structure: 'simple',
        columns: ['ProductNum', 'AssocPriceType', 'Price']
    });

    register({
        importType: 'ImportAssociatedPricingType',
        name: 'AssociatedPricingType',
        structure: 'simple',
        columns: ['AssocPriceType', 'Description', 'Account']
    });

    register({
        importType: 'ImportVendorParts',
        name: 'VendorParts',
        structure: 'simple',
        columns: ['Vendor', 'FishbowlPartNumber', 'VendorPartNumber', 'Cost', 'UOM', 'LeadTime', 'DefaultVendor', 'MinQty']
    });

    register({
        importType: 'ImportVendorCostRules',
        name: 'VendorCostRules',
        structure: 'simple',
        columns: ['VendorName', 'PartNum', 'VendorCostRuleName', 'Description', 'Qty', 'UOM', 'UnitCost', 'TotalCost']
    });

    // -------------------------------------------------------------------------
    // Materials — Products (4)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportProduct',
        name: 'Product',
        structure: 'simple',
        columns: ['PartNumber', 'ProductNumber', 'ProductDescription', 'ProductDetails', 'UOM', 'Price', 'Class', 'Active', 'Taxable', 'ComboBox', 'AllowUOM', 'ProductURL', 'ProductPictureURL', 'ProductUPC', 'ProductSKU', 'ProductSOItemType', 'IncomeAccount', 'Weight', 'WeightUOM', 'Width', 'Height', 'Length', 'sizeUOM', 'DefaultFlag', 'AlertNote', 'CartonCount', 'CartonType'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    register({
        importType: 'ImportProductPricing',
        name: 'ProductPricing',
        structure: 'simple',
        columns: ['Product', 'Price']
    });

    register({
        importType: 'ImportProductTree',
        name: 'ProductTree',
        structure: 'simple',
        columns: ['ProductNumber', 'Path']
    });

    register({
        importType: 'ImportProductTreeCategories',
        name: 'ProductTreeCategories',
        structure: 'simple',
        columns: ['Name', 'Description', 'Path']
    });

    // -------------------------------------------------------------------------
    // Materials — Inventory (5)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportAddInventory',
        name: 'AddInventory',
        structure: 'tracking',
        columns: ['PartNumber', 'PartDescription', 'Location', 'Qty', 'UOM', 'Cost', 'QbClass', 'Date', 'Note'],
        trackingPrefix: 'Tracking-',
        hasSerials: true
    });

    register({
        importType: 'ImportInventoryMove',
        name: 'InventoryMove',
        structure: 'tracking',
        columns: ['PartNumber', 'BeginLocation', 'Qty', 'EndLocation', 'Note'],
        trackingPrefix: 'Tracking-',
        hasSerials: false
    });

    register({
        importType: 'ImportScrapData',
        name: 'ScrapData',
        structure: 'simple',
        columns: ['PartNumber', 'Location', 'Qty', 'Customer', 'Class', 'Date', 'Note']
    });

    register({
        importType: 'ImportCycleCountData',
        name: 'CycleCountData',
        structure: 'tracking',
        columns: ['PartNumber', 'PartDescription', 'Location', 'Qty', 'QtyCommitted', 'UOM', 'Date', 'Note', 'Customer'],
        trackingPrefix: 'Tracking-',
        hasSerials: false
    });

    register({
        importType: 'ImportKit',
        name: 'Kit',
        structure: 'hierarchical',
        header: {
            flag: 'Product',
            columns: ['Flag', 'ProductNumber', 'Description', 'Details', 'Price', 'SKU', 'UPC', 'Active', 'Taxable', 'IncomeAccount', 'PictureURL', 'ShowOnSOComboBox', 'SpecifyKitPrice', 'AddKitAsGroup', 'DisplayType', 'QuickBooksClassName', 'TaxCode', 'Weight', 'WeightUOM', 'Length', 'Width', 'Height', 'SizeUOM'],
            dynamicFields: [
                { prefix: 'CF-', prop: 'customFields' }
            ]
        },
        item: {
            flag: 'KitItem',
            columns: ['Flag', 'ProductNumber', 'Quantity', 'UOM', 'Note', 'SOItemTypeID', 'KitItemTypeID', 'Description', 'MinQty', 'MaxQty', 'QtyPriceAdjustment', 'SortOrder', 'OptionalProductNumber', 'DefaultFlag', 'PriceAdjustment', 'TaxRateName', 'DiscountName'],
            dynamicFields: null
        }
    });

    // -------------------------------------------------------------------------
    // Sales (12)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportCustomers',
        name: 'Customer',
        structure: 'simple',
        columns: ['Name', 'AddressName', 'AddressContact', 'AddressType', 'IsDefault', 'Address', 'City', 'State', 'Zip', 'Country', 'Residential', 'Main', 'Home', 'Work', 'Mobile', 'Fax', 'Email', 'Pager', 'Web', 'Other', 'Group', 'CreditLimit', 'Status', 'Active', 'TaxRate', 'Salesman', 'DefaultPriority', 'Number', 'PaymentTerms', 'TaxExempt', 'TaxExemptNumber', 'URL', 'CarrierName', 'CarrierService', 'ShippingTerms', 'AlertNotes', 'QuickBooksClassName', 'ToBeEmailed', 'ToBePrinted', 'IssuableStatus'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    register({
        importType: 'ImportCustomerGroupRelations',
        name: 'CustomerGroupRelations',
        structure: 'simple',
        columns: ['CustomerName', 'CustomerGroupName']
    });

    register({
        importType: 'ImportCustomerParts',
        name: 'CustomerParts',
        structure: 'simple',
        columns: ['ProductNumber', 'Customer', 'CustomerPartNumber', 'CustomerPartLastPrice']
    });

    register({
        importType: 'ImportSalesOrder',
        name: 'SalesOrder',
        structure: 'hierarchical',
        header: {
            flag: 'SO',
            columns: ['Flag', 'SONum', 'Status', 'CustomerName', 'CustomerContact', 'BillToName', 'BillToAddress', 'BillToCity', 'BillToState', 'BillToZip', 'BillToCountry', 'ShipToName', 'ShipToAddress', 'ShipToCity', 'ShipToState', 'ShipToZip', 'ShipToCountry', 'ShipToResidential', 'CarrierName', 'TaxRateName', 'PriorityId', 'PONum', 'VendorPONum', 'Date', 'Salesman', 'ShippingTerms', 'PaymentTerms', 'FOB', 'Note', 'QuickBooksClassName', 'LocationGroupName', 'OrderDateScheduled', 'URL', 'CarrierService', 'DateExpired', 'Phone', 'Email', 'Category'],
            dynamicFields: [
                { prefix: 'CF-', prop: 'customFields' }
            ]
        },
        item: {
            flag: 'Item',
            columns: ['Flag', 'SOItemTypeID', 'ProductNumber', 'ProductDescription', 'ProductQuantity', 'UOM', 'ProductPrice', 'Taxable', 'TaxCode', 'Note', 'ItemQuickBooksClassName', 'ItemDateScheduled', 'ShowItem', 'KitItem', 'RevisionLevel', 'CustomerPartNumber'],
            dynamicFields: [
                { prefix: 'CFI-', prop: 'customFields' }
            ]
        }
    });

    register({
        importType: 'ImportSalesOrderDetails',
        name: 'SalesOrderDetails',
        structure: 'simple',
        columns: ['SONum', 'Status', 'CustomerName', 'CustomerContact', 'BillToName', 'BillToAddress', 'BillToCity', 'BillToState', 'BillToZip', 'BillToCountry', 'ShipToName', 'ShipToAddress', 'ShipToCity', 'ShipToState', 'ShipToZip', 'ShipToCountry', 'ShipToResidential', 'CarrierName', 'TaxRateName', 'PriorityId', 'PONum', 'VendorPONum', 'Date', 'Salesman', 'ShippingTerms', 'PaymentTerms', 'FOB', 'Note', 'QuickBooksClassName', 'LocationGroupName', 'OrderDateScheduled', 'URL', 'CarrierService', 'DateExpired', 'Phone', 'Email', 'Category'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    register({
        importType: 'ImportPickingData',
        name: 'PickingData',
        structure: 'simple',
        columns: ['PickNum']
    });

    register({
        importType: 'ImportPackingData',
        name: 'PackingData',
        structure: 'simple',
        columns: ['SONum']
    });

    register({
        importType: 'ImportShippingData',
        name: 'ShippingData',
        structure: 'simple',
        columns: ['ShipNum', 'Date', 'Carrier', 'Carrier Service']
    });

    register({
        importType: 'ImportShipCartonTracking',
        name: 'ShipCartonTracking',
        structure: 'simple',
        columns: ['Ship Number', 'Carton Number', 'Tracking Number', 'Carton Cost', 'Declared Value', 'Carton Weight', 'Carton Length', 'Carton Width', 'Carton Height']
    });

    register({
        importType: 'ImportPaymentData',
        name: 'PaymentData',
        structure: 'simple',
        columns: ['Date', 'SONum', 'PaymentMethod', 'Reference', 'Confirmation', 'ExpirationDate', 'DepositAccount', 'Amount', 'CurrencyRate', 'TransactionID', 'AuthCode', 'MerchantActNum', 'Info']
    });

    register({
        importType: 'ImportPricingRules',
        name: 'PricingRules',
        structure: 'simple',
        columns: ['name', 'description', 'isActive', 'productInclType', 'product', 'paApplies', 'paType', 'paPercent', 'paBaseAmountType', 'paAmount', 'rndApplies', 'roundType', 'rndToAmount', 'rndIsMinus', 'rndPMAmount', 'customerInclType', 'customer', 'dateApplies', 'dateBegin', 'dateEnd', 'qtyApplies', 'qtyMin', 'qtyMax', 'isAutoApply', 'isTier2', 'dateCreated', 'dateLastModified']
    });

    register({
        importType: 'ImportDiscounts',
        name: 'Discounts',
        structure: 'simple',
        columns: ['Name', 'Description', 'Type', 'Amount', 'Percentage', 'Taxable', 'IncomeAccount', 'ExpenseAccount', 'Active']
    });

    // -------------------------------------------------------------------------
    // Purchasing (5)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportVendors',
        name: 'Vendors',
        structure: 'simple',
        columns: ['Name', 'AddressName', 'AddressContact', 'AddressType', 'IsDefault', 'Address', 'City', 'State', 'Zip', 'Country', 'Main', 'Home', 'Work', 'Mobile', 'Fax', 'Email', 'Pager', 'Web', 'Other', 'DefaultTerms', 'DefaultShippingTerms', 'Status', 'AlertNotes', 'URL', 'DefaultCarrier', 'MinOrderAmount', 'Active', 'AccountNumber'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    register({
        importType: 'ImportPurchaseOrder',
        name: 'PurchaseOrder',
        structure: 'hierarchical',
        header: {
            flag: 'PO',
            columns: ['Flag', 'PONum', 'Status', 'VendorName', 'VendorContact', 'RemitToName', 'RemitToAddress', 'RemitToCity', 'RemitToState', 'RemitToZip', 'RemitToCountry', 'ShipToName', 'DeliverToName', 'ShipToAddress', 'ShipToCity', 'ShipToState', 'ShipToZip', 'ShipToCountry', 'CarrierName', 'CarrierService', 'VendorSONum', 'CustomerSONum', 'CreatedDate', 'CompletedDate', 'ConfirmedDate', 'FulfillmentDate', 'IssuedDate', 'Buyer', 'ShippingTerms', 'PaymentTerms', 'FOB', 'Note', 'QuickBooksClassName', 'LocationGroupName', 'URL', 'Phone', 'Email'],
            dynamicFields: [
                { prefix: 'CF-', prop: 'customFields' }
            ]
        },
        item: {
            flag: 'Item',
            columns: ['Flag', 'POItemTypeID', 'PartNumber', 'VendorPartNumber', 'PartQuantity', 'FulfilledQuantity', 'PickedQuantity', 'UOM', 'PartPrice', 'FulfillmentDate', 'LastFulfillmentDate', 'RevisionLevel', 'Note', 'QuickBooksClassName', 'CustomerJob'],
            dynamicFields: [
                { prefix: 'CFI-', prop: 'customFields' }
            ]
        }
    });

    register({
        importType: 'ImportReceivingData',
        name: 'ReceivingData',
        structure: 'tracking',
        columns: ['PONum', 'Fulfill', 'VendorPartNum', 'Qty', 'Location', 'Date', 'ShippingTrackingNumber', 'ShippingPackageCount', 'ShippingCarrier', 'ShippingCarrierService'],
        trackingPrefix: 'Tracking-',
        hasSerials: false
    });

    // -------------------------------------------------------------------------
    // Manufacturing (3)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportBillOfMaterials',
        name: 'BillOfMaterials',
        structure: 'hierarchical',
        header: {
            flag: 'BOM',
            columns: ['Flag', 'Number', 'Description', 'Active', 'Revision', 'CalendarCategory', 'AutoCreateType', 'QuickBooksClassName', 'Note', 'URL'],
            dynamicFields: [
                { prefix: 'CF-', prop: 'customFields' }
            ]
        },
        item: {
            flag: 'Item',
            columns: ['Flag', 'Description', 'Type', 'Part', 'Quantity', 'UOM', 'IsVariableQuantity', 'MinQuantity', 'MaxQuantity', 'OptionGroup', 'OptionGroupPrompt', 'IsGroupDefault', 'PriceAdjustment', 'IsOneTimeItem', 'IsStage', 'StageBOMNumber', 'ConfigurationSortOrder'],
            dynamicFields: [
                { prefix: 'CFI-', prop: 'customFields' }
            ]
        }
    });

    register({
        importType: 'ImportBillOfMaterialsDetails',
        name: 'BillOfMaterialsDetails',
        structure: 'simple',
        columns: [
            // BOM header fields
            'BOM Number', 'BOM Description', 'BOM Active', 'Auto Create', 'Revision', 'Calendar Category', 'QuickBooks Class Name', 'BOM Note', 'BOM URL',
            // Item fields
            'Item Type', 'Item Description', 'Part Number', 'Quantity', 'UOM', 'Is Variable Quantity', 'Min Quantity', 'Max Quantity', 'Option Group', 'Option Group Prompt', 'Is Group Default', 'Price Adjustment', 'Is One Time Item', 'Is Stage', 'Stage BOM Number', 'Configuration Sort Order'
        ],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' },
            { prefix: 'CFI-', prop: 'itemCustomFields' }
        ]
    });

    register({
        importType: 'ImportBillOfMaterialsInstructions',
        name: 'BillOfMaterialsInstructions',
        structure: 'simple',
        columns: ['BOM NUMBER', 'STEP NAME', 'STEP DESCRIPTION', 'STEP DETAILS', 'URL'],
        dynamicFields: [
            { prefix: 'CF-', prop: 'customFields' }
        ]
    });

    // -------------------------------------------------------------------------
    // Shopping Carts / Transfer Orders (2)
    // -------------------------------------------------------------------------

    register({
        importType: 'ImportGenericShoppingCart',
        name: 'GenericShoppingCart',
        structure: 'simple',
        columns: ['OrderNumber', 'OrderDate', 'OrderTax', 'OrderShipping', 'OrderHandling', 'OrderDiscount', 'OrderNote', 'OrderShipMethod', 'OrderCustomerPO', 'OrderQBClass', 'OrderLG', 'ShipFirstName', 'ShipLastName', 'ShipAddress1', 'ShipAddress2', 'ShipCity', 'ShipState', 'ShipZip', 'ShipCountry', 'ShipEmail', 'ShipPhone', 'ShipFax', 'BillFirstName', 'BillLastName', 'BillAddress1', 'BillAddress2', 'BillCity', 'BillState', 'BillZip', 'BillCountry', 'BillEmail', 'BillPhone', 'BillFax', 'ItemType', 'ItemNumber', 'ItemPrice', 'ItemQuantity', 'ItemUOM', 'ItemTaxable', 'ItemQBClass', 'ItemNote', 'KitItem', 'ShowItem', 'PaymentProcess', 'PaymentTotal', 'PaymentMethod', 'PaymentTransactionID', 'PaymentMisc', 'PaymentExpirationDate']
    });

    register({
        importType: 'ImportTransferOrder',
        name: 'TransferOrder',
        structure: 'hierarchical',
        header: {
            flag: 'TO',
            columns: ['Flag', 'TONum', 'TOType', 'Status', 'FromLocationGroup', 'FromLocation', 'FromAddressName', 'FromAddressStreet', 'FromAddressCity', 'FromAddressState', 'FromAddressZip', 'FromAddressCountry', 'ToLocationGroup', 'ToAddressName', 'ToAddressStreet', 'ToAddressCity', 'ToAddressState', 'ToAddressZip', 'ToAddressCountry', 'OwnerIsFrom', 'CreatedDate', 'IssuedDate', 'CompletedDate', 'FulfillmentDate', 'ConfirmedDate', 'CarrierName', 'CarrierService', 'Note'],
            dynamicFields: [
                { prefix: 'CF-', prop: 'customFields' }
            ]
        },
        item: {
            flag: 'Item',
            columns: ['Flag', 'PartNumber', 'PartQuantity', 'UOM', 'FulfillmentDate', 'Note'],
            dynamicFields: null
        }
    });

    // =========================================================================
    // Section 7: API Call Type Registry (FishbowlJSON)
    // =========================================================================

    var _apiSchemas = {};

    /**
     * Register an API call type schema. Creates a named factory on FishbowlJSON.
     * @param {object} schema
     * @param {string} schema.enumName - Java ApiCallType enum constant (e.g., 'PART_GET')
     * @param {string} schema.baseName - Request base name (e.g., 'PartGet')
     * @param {string} schema.category - Grouping for documentation
     * @param {string[]} [schema.arrayPaths] - Response paths that should always be arrays
     */
    function registerApi(schema) {
        _apiSchemas[schema.enumName] = schema;
        var rqName = schema.baseName + 'Rq';
        FishbowlJSON[rqName] = function (data) {
            var rq = {};
            rq[rqName] = data || {};
            Object.defineProperty(rq, '_type', { value: schema.enumName, enumerable: false });
            Object.defineProperty(rq, '_rqName', { value: rqName, enumerable: false });
            Object.defineProperty(rq, '_rsName', { value: schema.baseName + 'Rs', enumerable: false });
            return rq;
        };
    }

    /**
     * Walk a dot-separated path and normalize the terminal value to an array.
     * Handles intermediate arrays (walks into each element).
     * @param {object} obj
     * @param {string[]} pathParts
     */
    function _normalizeAtPath(obj, pathParts) {
        if (!obj || pathParts.length === 0) return;
        if (pathParts.length === 1) {
            var key = pathParts[0];
            if (obj[key] !== undefined && !Array.isArray(obj[key])) {
                obj[key] = obj[key] === null ? [] : [obj[key]];
            } else if (obj[key] === undefined) {
                obj[key] = [];
            }
            return;
        }
        var next = obj[pathParts[0]];
        var remaining = pathParts.slice(1);
        if (Array.isArray(next)) {
            for (var i = 0; i < next.length; i++) {
                _normalizeAtPath(next[i], remaining);
            }
        } else if (next && typeof next === 'object') {
            _normalizeAtPath(next, remaining);
        }
    }

    /**
     * Normalize a value to always be an array.
     * null/undefined → [], single value → [value], array → unchanged.
     * @param {*} val
     * @returns {Array}
     */
    FishbowlJSON.ensureArray = function (val) {
        if (val === null || val === undefined) return [];
        if (Array.isArray(val)) return val;
        return [val];
    };

    /**
     * Walk known array paths for a response type and fix single-object → array.
     * @param {string|object} rqOrType - Enum name string or request object with _type.
     * @param {object} response - The parsed response object.
     * @returns {object} The same response object, mutated in place.
     */
    FishbowlJSON.normalizeRs = function (rqOrType, response) {
        var enumName = typeof rqOrType === 'string' ? rqOrType : rqOrType._type;
        var schema = _apiSchemas[enumName];
        if (!schema || !schema.arrayPaths) return response;
        var rsName = schema.baseName + 'Rs';
        var root = response[rsName] || response;
        for (var i = 0; i < schema.arrayPaths.length; i++) {
            _normalizeAtPath(root, schema.arrayPaths[i].split('.'));
        }
        return response;
    };

    /**
     * List all registered API call enum names, sorted.
     * @returns {string[]}
     */
    FishbowlJSON.listApiCalls = function () {
        return Object.keys(_apiSchemas).sort();
    };

    /**
     * Get the schema for a registered API call type.
     * @param {string} enumName
     * @returns {object|null}
     */
    FishbowlJSON.getApiSchema = function (enumName) {
        return _apiSchemas[enumName] || null;
    };

    // -------------------------------------------------------------------------
    // Inventory (8)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'ADD_INVENTORY',
        baseName: 'AddInventory',
        category: 'inventory',
        arrayPaths: ['AddInventoryRs.PartTracking.PartTrackingItem']
    });

    registerApi({
        enumName: 'ADJUST_INVENTORY',
        baseName: 'AdjustInventory',
        category: 'inventory',
        arrayPaths: []
    });

    registerApi({
        enumName: 'CYCLE_COUNT',
        baseName: 'CycleCount',
        category: 'inventory',
        arrayPaths: ['CycleCountItem']
    });

    registerApi({
        enumName: 'GET_TOTAL_INVENTORY',
        baseName: 'GetTotalInventory',
        category: 'inventory',
        arrayPaths: ['TotalInventory.TotalInventoryItem']
    });

    registerApi({
        enumName: 'INV_QTY',
        baseName: 'InvQty',
        category: 'inventory',
        arrayPaths: ['InvQty.InvQtyItem']
    });

    registerApi({
        enumName: 'MOVE',
        baseName: 'Move',
        category: 'inventory',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SCRAP_INVENTORY',
        baseName: 'ScrapInventory',
        category: 'inventory',
        arrayPaths: []
    });

    registerApi({
        enumName: 'TAG_INFO',
        baseName: 'TagInfo',
        category: 'inventory',
        arrayPaths: ['Tag.Tracking.TrackingItem']
    });

    // -------------------------------------------------------------------------
    // Part (7)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'PART_GET',
        baseName: 'PartGet',
        category: 'part',
        arrayPaths: [
            'Part.PartTrackingList.PartTracking',
            'Part.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'PART_QUERY',
        baseName: 'PartQuery',
        category: 'part',
        arrayPaths: ['Part']
    });

    registerApi({
        enumName: 'PART_SAVE',
        baseName: 'PartSave',
        category: 'part',
        arrayPaths: []
    });

    registerApi({
        enumName: 'PART_COST',
        baseName: 'PartCost',
        category: 'part',
        arrayPaths: []
    });

    registerApi({
        enumName: 'PART_TAG_QUERY',
        baseName: 'PartTagQuery',
        category: 'part',
        arrayPaths: ['Tag']
    });

    registerApi({
        enumName: 'SAVE_UPC',
        baseName: 'SaveUPC',
        category: 'part',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_PART_TRACKING_LIST',
        baseName: 'GetPartTrackingList',
        category: 'part',
        arrayPaths: ['PartTracking']
    });

    // -------------------------------------------------------------------------
    // Sales Order (11)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'LOAD_SO',
        baseName: 'LoadSO',
        category: 'salesorder',
        arrayPaths: [
            'SalesOrder.Items.SalesOrderItem',
            'SalesOrder.Items.SalesOrderItem.CustomFieldList.CustomField',
            'SalesOrder.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'SO_SAVE',
        baseName: 'SOSave',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_SO_LIST',
        baseName: 'GetSOList',
        category: 'salesorder',
        arrayPaths: ['SalesOrder']
    });

    registerApi({
        enumName: 'GET_SO_SEARCH_LIST',
        baseName: 'GetSOSearchList',
        category: 'salesorder',
        arrayPaths: ['SalesOrder']
    });

    registerApi({
        enumName: 'ISSUE_SO',
        baseName: 'IssueSO',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'UNISSUE_SO',
        baseName: 'UnissueSO',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'CLOSE_SHORT_SO',
        baseName: 'CloseShortSO',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'VOID_SO',
        baseName: 'VoidSO',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'CALCULATE_SO',
        baseName: 'CalculateSO',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'ADD_SO_ITEM',
        baseName: 'AddSOItem',
        category: 'salesorder',
        arrayPaths: []
    });

    registerApi({
        enumName: 'QUICK_SHIP',
        baseName: 'QuickShip',
        category: 'salesorder',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Customer (5)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'CUSTOMER_GET',
        baseName: 'CustomerGet',
        category: 'sales',
        arrayPaths: [
            'Customer.Addresses.Address',
            'Customer.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'CUSTOMER_SAVE',
        baseName: 'CustomerSave',
        category: 'sales',
        arrayPaths: []
    });

    registerApi({
        enumName: 'CUSTOMER_LIST',
        baseName: 'CustomerList',
        category: 'sales',
        arrayPaths: ['Customer']
    });

    registerApi({
        enumName: 'CUSTOMER_NAME_LIST',
        baseName: 'CustomerNameList',
        category: 'sales',
        arrayPaths: ['Customer']
    });

    // NOTE: CUSTOMER_GROUP_RELATIONS does not exist in Java ApiCallType enum.
    // Removed — was never a valid API call type.

    // -------------------------------------------------------------------------
    // Vendor (4)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'VENDOR_GET',
        baseName: 'VendorGet',
        category: 'purchasing',
        arrayPaths: [
            'Vendor.Addresses.Address',
            'Vendor.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'VENDOR_SAVE',
        baseName: 'VendorSave',
        category: 'purchasing',
        arrayPaths: []
    });

    registerApi({
        enumName: 'VENDOR_LIST',
        baseName: 'VendorList',
        category: 'purchasing',
        arrayPaths: ['Vendor']
    });

    registerApi({
        enumName: 'VENDOR_NAME_LIST',
        baseName: 'VendorNameList',
        category: 'purchasing',
        arrayPaths: ['Vendor']
    });

    // -------------------------------------------------------------------------
    // Product (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'PRODUCT_GET',
        baseName: 'ProductGet',
        category: 'product',
        arrayPaths: [
            'Product.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'PRODUCT_PRICE',
        baseName: 'ProductPrice',
        category: 'product',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_PRODUCT_LIST',
        baseName: 'GetProductList',
        category: 'product',
        arrayPaths: ['Product']
    });

    // -------------------------------------------------------------------------
    // Purchase Order (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'PO_SAVE',
        baseName: 'POSave',
        category: 'purchasing',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_PO_LIST',
        baseName: 'GetPOList',
        category: 'purchasing',
        arrayPaths: ['PurchaseOrder']
    });

    registerApi({
        enumName: 'GET_RECEIPT',
        baseName: 'GetReceipt',
        category: 'purchasing',
        arrayPaths: [
            'Receipt.ReceiptItem',
            'Receipt.ReceiptItem.Tracking.TrackingItem'
        ]
    });

    registerApi({
        enumName: 'SAVE_RECEIPT',
        baseName: 'SaveReceipt',
        category: 'purchasing',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Shipping (7)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'SHIP',
        baseName: 'Ship',
        category: 'shipping',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_SHIPMENT',
        baseName: 'GetShipment',
        category: 'shipping',
        arrayPaths: [
            'Shipment.ShipmentItem',
            'Shipment.Carton',
            'Shipment.Carton.CartonItem'
        ]
    });

    registerApi({
        enumName: 'SAVE_SHIPMENT',
        baseName: 'SaveShipment',
        category: 'shipping',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_SHIP_LIST',
        baseName: 'GetShipList',
        category: 'shipping',
        arrayPaths: ['Shipment']
    });

    registerApi({
        enumName: 'GET_SHIP_NOW_LIST',
        baseName: 'GetShipNowList',
        category: 'shipping',
        arrayPaths: ['Shipment']
    });

    registerApi({
        enumName: 'VOID_SHIPMENT',
        baseName: 'VoidShipment',
        category: 'shipping',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_SHIP_CARTON_TRACKING',
        baseName: 'GetShipCartonTracking',
        category: 'shipping',
        arrayPaths: ['Carton', 'Carton.TrackingItem']
    });

    // -------------------------------------------------------------------------
    // Picking (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'GET_PICK',
        baseName: 'GetPick',
        category: 'picking',
        arrayPaths: [
            'Pick.PickItem',
            'Pick.PickItem.Tracking.TrackingItem'
        ]
    });

    registerApi({
        enumName: 'SAVE_PICK',
        baseName: 'SavePick',
        category: 'picking',
        arrayPaths: []
    });

    registerApi({
        enumName: 'PICK_QUERY',
        baseName: 'PickQuery',
        category: 'picking',
        arrayPaths: ['Pick']
    });

    // -------------------------------------------------------------------------
    // Receiving (2)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'RECEIVING_LIST',
        baseName: 'ReceivingList',
        category: 'receiving',
        arrayPaths: ['Receiving']
    });

    registerApi({
        enumName: 'RECEIVING_ITEMS',
        baseName: 'ReceivingItems',
        category: 'receiving',
        arrayPaths: ['ReceivingItem']
    });

    // -------------------------------------------------------------------------
    // Payment (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'MAKE_PAYMENT',
        baseName: 'MakePayment',
        category: 'payment',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_PAYMENT_LIST',
        baseName: 'GetPaymentList',
        category: 'payment',
        arrayPaths: ['Payment']
    });

    registerApi({
        enumName: 'GET_NEXT_ORDER_NUMBER',
        baseName: 'GetNextOrderNumber',
        category: 'payment',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Manufacturing (6)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'BUILD_BOM',
        baseName: 'BuildBom',
        category: 'manufacturing',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_WORK_ORDER',
        baseName: 'GetWorkOrder',
        category: 'manufacturing',
        arrayPaths: [
            'WorkOrder.WOItem',
            'WorkOrder.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'SAVE_WORK_ORDER',
        baseName: 'SaveWorkOrder',
        category: 'manufacturing',
        arrayPaths: []
    });

    registerApi({
        enumName: 'WORK_ORDER_LIST',
        baseName: 'WorkOrderList',
        category: 'manufacturing',
        arrayPaths: ['WorkOrder']
    });

    registerApi({
        enumName: 'ADD_WORK_ORDER_ITEM',
        baseName: 'AddWorkOrderItem',
        category: 'manufacturing',
        arrayPaths: []
    });

    registerApi({
        enumName: 'YIELD',
        baseName: 'Yield',
        category: 'manufacturing',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Location (6)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'LOCATION_GROUP',
        baseName: 'LocationGroup',
        category: 'location',
        arrayPaths: ['LocationGroup']
    });

    registerApi({
        enumName: 'LOCATION_LIST',
        baseName: 'LocationList',
        category: 'location',
        arrayPaths: ['Location']
    });

    registerApi({
        enumName: 'LOCATION_QUERY',
        baseName: 'LocationQuery',
        category: 'location',
        arrayPaths: ['Location']
    });

    registerApi({
        enumName: 'DEF_LOC_LIST',
        baseName: 'DefLocList',
        category: 'location',
        arrayPaths: ['DefaultLocation']
    });

    registerApi({
        enumName: 'DEF_PART_LOC_QUERY',
        baseName: 'DefPartLocQuery',
        category: 'location',
        arrayPaths: ['DefaultPartLocation']
    });

    registerApi({
        enumName: 'SET_DEF_PART_LOC',
        baseName: 'SetDefPartLoc',
        category: 'location',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Import/Export (6)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'IMPORT',
        baseName: 'Import',
        category: 'importexport',
        arrayPaths: []
    });

    registerApi({
        enumName: 'IMPORT_HEADER',
        baseName: 'ImportHeader',
        category: 'importexport',
        arrayPaths: ['Header.Row']
    });

    registerApi({
        enumName: 'IMPORT_LIST',
        baseName: 'ImportList',
        category: 'importexport',
        arrayPaths: ['ImportType']
    });

    registerApi({
        enumName: 'EXPORT',
        baseName: 'Export',
        category: 'importexport',
        arrayPaths: ['Row']
    });

    registerApi({
        enumName: 'EXPORT_LIST',
        baseName: 'ExportList',
        category: 'importexport',
        arrayPaths: ['ExportType']
    });

    registerApi({
        enumName: 'EXPORT_QUERY',
        baseName: 'ExportQuery',
        category: 'importexport',
        arrayPaths: ['Row']
    });

    // -------------------------------------------------------------------------
    // General / Setup (15)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'COMPATIBLE',
        baseName: 'Compatible',
        category: 'general',
        arrayPaths: []
    });

    registerApi({
        enumName: 'ADD_MEMO',
        baseName: 'AddMemo',
        category: 'general',
        arrayPaths: []
    });

    registerApi({
        enumName: 'CARRIER_LIST',
        baseName: 'CarrierList',
        category: 'general',
        arrayPaths: ['Carrier']
    });

    registerApi({
        enumName: 'GET_CARRIER_LIST',
        baseName: 'GetCarrierList',
        category: 'general',
        arrayPaths: ['Carrier', 'Carrier.Services.CarrierService']
    });

    registerApi({
        enumName: 'GET_CUSTOM_FIELDS',
        baseName: 'GetCustomFields',
        category: 'general',
        arrayPaths: ['CustomField']
    });

    registerApi({
        enumName: 'EMAIL_REPORT',
        baseName: 'EmailReport',
        category: 'general',
        arrayPaths: []
    });

    registerApi({
        enumName: 'PRINT_REPORT',
        baseName: 'PrintReport',
        category: 'general',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SAVE_REPORT',
        baseName: 'SaveReport',
        category: 'general',
        arrayPaths: []
    });

    registerApi({
        enumName: 'STATE_AND_COUNTRY',
        baseName: 'StateAndCountry',
        category: 'general',
        arrayPaths: ['Country', 'Country.State']
    });

    registerApi({
        enumName: 'USER_LIST',
        baseName: 'UserList',
        category: 'general',
        arrayPaths: ['User']
    });

    registerApi({
        enumName: 'UOM',
        baseName: 'UOM',
        category: 'general',
        arrayPaths: ['UOM.UOMConversion']
    });

    registerApi({
        enumName: 'UOM_LIST',
        baseName: 'UOMList',
        category: 'general',
        arrayPaths: ['UOM']
    });

    registerApi({
        enumName: 'QB_CLASS_LIST_GET',
        baseName: 'QBClassListGet',
        category: 'general',
        arrayPaths: ['QBClass']
    });

    registerApi({
        enumName: 'PAYMENT_TERMS_GET',
        baseName: 'PaymentTermsGet',
        category: 'general',
        arrayPaths: ['PaymentTerms']
    });

    registerApi({
        enumName: 'KIT_ITEMS_GET',
        baseName: 'KitItemsGet',
        category: 'general',
        arrayPaths: ['KitItem']
    });

    // -------------------------------------------------------------------------
    // Plugin / Property (6)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'GET_PLUGIN_DATA',
        baseName: 'GetPluginData',
        category: 'plugin',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SAVE_PLUGIN_DATA',
        baseName: 'SavePluginData',
        category: 'plugin',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_SYSTEM_PROPERTY',
        baseName: 'GetSystemProperty',
        category: 'plugin',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SET_SYSTEM_PROPERTY',
        baseName: 'SetSystemProperty',
        category: 'plugin',
        arrayPaths: []
    });

    registerApi({
        enumName: 'LOAD_WEB_PROPERTIES',
        baseName: 'LoadWebProperties',
        category: 'plugin',
        arrayPaths: ['Property']
    });

    registerApi({
        enumName: 'SAVE_WEB_PROPERTIES',
        baseName: 'SaveWebProperties',
        category: 'plugin',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Accounting (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'DISCONNECT_ACCOUNTING',
        baseName: 'DisconnectAccounting',
        category: 'accounting',
        arrayPaths: []
    });

    registerApi({
        enumName: 'MARK_AS_POSTED_DATA',
        baseName: 'MarkAsPostedData',
        category: 'accounting',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SAVE_ASACCOUNT',
        baseName: 'SaveAsAccount',
        category: 'accounting',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Transfer Order (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'GET_TRANSFER_ORDER_LIST',
        baseName: 'GetTransferOrderList',
        category: 'transferorder',
        arrayPaths: ['TransferOrder']
    });

    registerApi({
        enumName: 'LOAD_TRANSFER_ORDER',
        baseName: 'LoadTransferOrder',
        category: 'transferorder',
        arrayPaths: [
            'TransferOrder.TOItem',
            'TransferOrder.CustomFieldList.CustomField'
        ]
    });

    registerApi({
        enumName: 'TRANSFER_ORDER_SAVE',
        baseName: 'TransferOrderSave',
        category: 'transferorder',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Discount / Tax (4)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'DISCOUNT_GET',
        baseName: 'DiscountGet',
        category: 'discounttax',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SAVE_DISCOUNT',
        baseName: 'SaveDiscount',
        category: 'discounttax',
        arrayPaths: []
    });

    registerApi({
        enumName: 'TAX_RATE_GET',
        baseName: 'TaxRateGet',
        category: 'discounttax',
        arrayPaths: []
    });

    registerApi({
        enumName: 'SAVE_TAX_RATE',
        baseName: 'SaveTaxRate',
        category: 'discounttax',
        arrayPaths: []
    });

    // -------------------------------------------------------------------------
    // Tag (3)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'TAG_MOVE',
        baseName: 'TagMove',
        category: 'tag',
        arrayPaths: []
    });

    registerApi({
        enumName: 'TAG_QUERY',
        baseName: 'TagQuery',
        category: 'tag',
        arrayPaths: ['Tag']
    });

    // TAG_INFO already registered under Inventory above

    // -------------------------------------------------------------------------
    // Image / Misc (2)
    // -------------------------------------------------------------------------

    registerApi({
        enumName: 'SAVE_IMAGE',
        baseName: 'SaveImage',
        category: 'misc',
        arrayPaths: []
    });

    registerApi({
        enumName: 'GET_BI_REPORT_LIST',
        baseName: 'GetBIReportList',
        category: 'misc',
        arrayPaths: ['BIReport']
    });

    // =========================================================================
    // Return both namespaces
    // =========================================================================

    return {
        FishbowlCSV: FishbowlCSV,
        FishbowlJSON: FishbowlJSON
    };

}));
