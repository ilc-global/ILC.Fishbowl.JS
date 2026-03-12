# fishbowl.js

CSV generation and API request building for Fishbowl ERP.

## Overview

`fishbowl.js` provides two namespaces:

| Namespace | Purpose |
|---|---|
| **FishbowlCSV** | Generate CSV strings for all 56 Fishbowl import types |
| **FishbowlJSON** | Build API request envelopes for all 109 Fishbowl legacy API call types |

Single-file, zero dependencies, UMD export (browser `<script>`, CommonJS, AMD).

## Quick Start

```html
<script src="fishbowl/fishbowl.js"></script>
<script src="fb/fb.js"></script>
<script>
    // Generate a CSV import
    var imp = FishbowlCSV.SalesOrder({
        header: { SONum: '', Status: '20', CustomerName: 'Acme Corp', /* ... */ },
        items: [{ SOItemTypeID: '10', ProductNumber: 'WIDGET-A', Qty: '5', UOM: 'ea' }]
    });
    var csv = imp.toCSV();

    // Send it to Fishbowl
    var result = FB.importCSV('ImportSalesOrder', csv);

    // Or build a JSON API request
    var rq = FishbowlJSON.PartGetRq({ Number: 'B201' });
    var rs = FB.legacyApi(rq);
</script>
```

## FishbowlCSV — CSV Import Generation

### Creating an import

Every import type has a named factory method:

```javascript
var imp = FishbowlCSV.AddInventory({
    PartNumber: 'B201', Location: 'Main Warehouse',
    Qty: '10', UOM: 'ea', Cost: '5.00',
    tracking: { 'Lot Number': 'LOT-2026-A' }
});

imp.toCSV();       // CSV string ready for FB.importCSV()
imp.toRows();      // Array of CSV row strings
imp.toImportRq();  // { Type: 'ImportAddInventory', Rows: { Row: [...] } }
```

### Import structures

Import schemas use one of three structures:

| Structure | Description | Example types |
|---|---|---|
| **simple** | Single header row + single data row | Part, Customer, Vendors |
| **hierarchical** | Header row + item rows (flag column) | SalesOrder, PurchaseOrder, BOM |
| **tracking** | Standard columns + dynamic `Tracking-*` columns + optional serial lines | AddInventory, InventoryMove, CycleCountData |

### All 56 import types

#### Accounting (3)
`TaxRates`, `Currency`, `QBClass`

#### General (11)
`Carriers`, `CountryAndState`, `CustomFieldData`, `CustomFieldProductAndPart`, `Locations`, `MemoData`, `PaymentTerms`, `UOM`, `UOMConversions`, `Users`, `Discounts`

#### Materials — Parts (13)
`Part`, `PartCost`, `PartStandardCost`, `PartUOM`, `PartAndQty`, `PartAndProductRenaming`, `PartProductVendorPricing`, `PartImage`, `PartBOM`, `PartReorderLevels`, `PartCustomFields`, `PartTrackingAssign`, `PartTag`

#### Materials — Products (4)
`Product`, `ProductPricing`, `ProductTree`, `ProductTreeCategories`

#### Materials — Inventory (5)
`AddInventory`, `InventoryMove`, `ScrapData`, `CycleCountData`, `DefaultLocations`

#### Sales (12)
`SalesOrder`, `SalesOrderDetails`, `Customer`, `CustomerGroupRelations`, `CustomerParts`, `AssociatedPricing`, `AssociatedPricingType`, `ReorderLevels`, `PricingRules`, `ShipCartonTracking`, `PaymentData`, `GenericShoppingCart`

#### Purchasing (5)
`PurchaseOrder`, `Vendors`, `VendorParts`, `VendorCostRules`, `TransferOrder`

#### Manufacturing (3)
`BOM`, `BOMDetails`, `BOMInstructions`

#### Shopping Carts / Transfer Orders (2)
`Kit`, `GenericShoppingCartItem`

### Introspection

```javascript
FishbowlCSV.listTypes();              // All 56 type names, sorted
FishbowlCSV.getSchema('ImportPart');   // Full schema object
FishbowlCSV.getColumns('ImportPart');  // Column names array
FishbowlCSV.getTemplate('ImportPart'); // Empty CSV header row
```

### Dynamic fields

Some import types support dynamic columns for custom fields or tracking:

```javascript
// Custom fields (simple/hierarchical)
var imp = FishbowlCSV.Part({
    PartNumber: 'B201', PartDescription: 'Widget',
    customFields: { 'Color': 'Red', 'Weight': '2.5' }
});
// → header includes "CF-Color", "CF-Weight"

// Tracking fields (tracking structure)
var imp = FishbowlCSV.AddInventory({
    PartNumber: 'B201', Location: 'Main', Qty: '10', UOM: 'ea',
    tracking: { 'Lot Number': 'LOT-001', 'Revision Level': 'Rev-C' },
    serials: ['SN-001', 'SN-002', 'SN-003']
});
// → header includes "Tracking-Lot Number", "Tracking-Revision Level"
// → serial numbers appended as raw lines after the data row
```

### Text sanitization

```javascript
FishbowlCSV.sanitize(str);             // Strip \r, smart quotes → straight
FishbowlCSV.sanitize(str, 'iso88591'); // Also strip non-ISO-8859-1 chars
```

## FishbowlJSON — API Request Building

### Factory methods

Every registered API call type has a factory that creates a properly structured request object:

```javascript
var rq = FishbowlJSON.PartGetRq({ Number: 'B201' });
// Returns: { PartGetRq: { Number: 'B201' } }
// With non-enumerable: rq._type = 'PART_GET', rq._rqName = 'PartGetRq', rq._rsName = 'PartGetRs'

// Send via fb.js
var rs = FB.legacyApi(rq);     // self-describing — extracts _type automatically
```

The `_type`, `_rqName`, and `_rsName` properties are non-enumerable, so they are excluded from `JSON.stringify()` but available for routing and response handling.

### Response normalization

Fishbowl's XML-to-JSON conversion collapses single-element arrays into objects. `normalizeRs` fixes this using registered `arrayPaths`:

```javascript
var rq = FishbowlJSON.PartGetRq({ Number: 'B201' });
var rs = FB.legacyApi(rq);

// Before: rs.Part.PartTrackingList.PartTracking = { Name: 'Lot' }  (object, not array!)
FishbowlJSON.normalizeRs(rq, rs);
// After:  rs.Part.PartTrackingList.PartTracking = [{ Name: 'Lot' }]  (always an array)
```

### Helper utilities

```javascript
FishbowlJSON.ensureArray(val);    // null/undefined → [], single → [single], array → unchanged
FishbowlJSON.envelope('PartGetRq', payload, ticketKey);  // Wrap in FbiJson envelope
FishbowlJSON.importRq('ImportPart', csvRowsOrString);    // Build ImportRq payload
FishbowlJSON.issueSORq('10045');      // { SONumber: '10045' }
FishbowlJSON.quickShipRq('10045');    // { SONumber: '10045' }
FishbowlJSON.voidSORq('10045');       // { SONumber: '10045' }
FishbowlJSON.buildBomRq('BOM-1', 10, 'Main');  // { BomNumber, Quantity, LocationGroupName }
```

### Introspection

```javascript
FishbowlJSON.listApiCalls();          // All 109 enum names, sorted
FishbowlJSON.getApiSchema('PART_GET');
// → { enumName: 'PART_GET', baseName: 'PartGet', category: 'part',
//     arrayPaths: ['Part.PartTrackingList.PartTracking', ...] }
```

### All 109 API call types by category

| Category | Count | Examples |
|---|---|---|
| Inventory | 8 | `ADD_INVENTORY`, `CYCLE_COUNT`, `INVENTORY_QUANTITY`, `MOVE`, `PICK_QUERY`, `SCRAP`, `TAG_INFO`, `TAG_SEARCH` |
| Part | 7 | `PART_GET`, `SAVE_PART`, `PART_QUERY`, `PART_SEARCH`, `GET_PART_COST`, `GET_PART_IMAGE`, `SAVE_PART_IMAGE` |
| Sales Order | 11 | `LOAD_SO`, `SAVE_SO`, `ISSUE_SO`, `VOID_SO`, `CANCEL_SO`, `QUICK_SHIP`, `GET_SO_LIST`, `SO_ITEM_QUERY`, ... |
| Customer | 5 | `CUSTOMER_GET`, `CUSTOMER_LIST`, `SAVE_CUSTOMER`, `CUSTOMER_NAME_LIST`, `GET_CUSTOMER_PARTS_LIST` |
| Vendor | 4 | `VENDOR_GET`, `VENDOR_LIST`, `SAVE_VENDOR`, `VENDOR_NAME_LIST` |
| Product | 3 | `PRODUCT_GET`, `SAVE_PRODUCT`, `PRODUCT_SEARCH` |
| Purchase Order | 3 | `GET_PO`, `GET_PO_LIST`, `SAVE_PO` |
| Shipping | 7 | `SHIP`, `GET_SHIPMENT`, `SAVE_SHIPMENT`, `GET_SHIP_LIST`, `GET_SHIP_NEXT`, `GET_SHIP_NOW`, `SHIP_QUERY` |
| Picking | 3 | `GET_PICK`, `SAVE_PICK`, `FINISH_PICK` |
| Receiving | 2 | `GET_RECEIPT`, `SAVE_RECEIPT` |
| Payment | 3 | `MAKE_PAYMENT`, `GET_PAYMENT`, `VOID_PAYMENT` |
| Manufacturing | 6 | `BUILD_BOM`, `GET_WORK_ORDER`, `SAVE_WORK_ORDER`, `CLOSE_SHORT_WO`, `FINISH_MANUFACTURE`, `GET_WORK_ORDER_LIST` |
| Location | 6 | `LOCATION_LIST`, `LOCATION_GROUP_LIST`, `ADD_LOCATION`, `LOCATION_QUERY`, `SET_DEFAULT_LOCATION`, `DELETE_LOCATION` |
| Import/Export | 6 | `IMPORT`, `IMPORT_HEADER`, `EXPORT`, `EXPORT_LIST`, `PRINT_REPORT`, `DATA_QUERY` |
| General / Setup | 15 | `CARRIER_LIST`, `UOM_LIST`, `CURRENCY_LIST`, `TAX_RATE_GET`, `CUSTOM_FIELD_LIST`, `CUSTOM_LIST`, `COMPANY_GET`, ... |
| Plugin / Property | 6 | `GET_PLUGIN_DATA`, `SAVE_PLUGIN_DATA`, `GET_PROPERTY`, `SET_PROPERTY`, `EXECUTE_QUERY`, `GET_MEMO` |
| Accounting | 3 | `GET_ACCOUNT_LIST`, `GET_ACCOUNT_BALANCE`, `SAVE_ACCOUNT` |
| Transfer Order | 3 | `GET_TRANSFER_ORDER`, `SAVE_TRANSFER_ORDER`, `GET_TRANSFER_ORDER_LIST` |
| Discount / Tax | 4 | `GET_DISCOUNT_LIST`, `SAVE_DISCOUNT`, `GET_TAX_RATE_LIST`, `SAVE_TAX_RATE` |
| Tag | 3 | `TAG_INFO`, `TAG_SEARCH`, `SAVE_TAG` |
| Image / Misc | 2 | `GET_IMAGE_LIST`, `SAVE_IMAGE` |

## Fishbowl Documentation References

### CSV Import Instructions

Each import type has official instructions from Fishbowl describing required columns, data formats, and examples. These links document the exact CSV format that `FishbowlCSV` generates.

| Factory Method | Import Type | Instructions |
|---|---|---|
| `AddInventory` | ImportAddInventory | [Instructions](https://fishbowlhelp.com/files/csv/importInventoryQtys.html) |
| `AssociatedPricing` | ImportAssociatedPricing | [Instructions](https://fishbowlhelp.com/files/csv/importAssocPricing.html) |
| `AssociatedPricingType` | ImportAssociatedPricingType | [Instructions](https://fishbowlhelp.com/files/csv/importAssocPricingType.html) |
| `BOM` | ImportBOM | [Instructions](https://fishbowlhelp.com/files/csv/exportBOM.html) |
| `BOMDetails` | ImportBOMDetails | [Instructions](https://fishbowlhelp.com/files/csv/exportBomDetails.html) |
| `BOMInstructions` | ImportBOMInstructions | [Instructions](https://fishbowlhelp.com/files/csv/exportBOMInstructions.html) |
| `Carriers` | ImportCarriers | [Instructions](https://fishbowlhelp.com/files/csv/exportCarriers.html) |
| `CountryAndState` | ImportCountryAndState | [Instructions](https://fishbowlhelp.com/files/csv/countrystate.html) |
| `Currency` | ImportCurrency | [Instructions](https://fishbowlhelp.com/files/csv/currency.html) |
| `Customer` | ImportCustomer | [Instructions](https://fishbowlhelp.com/files/csv/importCustomer.html) |
| `CustomerGroupRelations` | ImportCustomerGroupRelations | [Instructions](https://fishbowlhelp.com/files/csv/importCustomerGroupRelations.html) |
| `CustomerParts` | ImportCustomerParts | [Instructions](https://fishbowlhelp.com/files/csv/importCustomerParts.html) |
| `CustomFieldData` | ImportCustomFieldData | [Instructions](https://fishbowlhelp.com/files/csv/importCustomFieldData.html) |
| `CustomFieldProductAndPart` | ImportCustomFields | [Instructions](https://fishbowlhelp.com/files/csv/importCustomFields.html) |
| `CycleCountData` | ImportCycleCountData | [Instructions](https://fishbowlhelp.com/files/csv/exportCycleCount.html) |
| `DefaultLocations` | ImportDefaultLocations | [Instructions](https://fishbowlhelp.com/files/csv/importDefaultLocation.html) |
| `Discounts` | ImportDiscounts | [Instructions](https://fishbowlhelp.com/files/csv/importDiscounts.html) |
| `GenericShoppingCart` | ImportGenericShoppingCart | [Instructions](https://fishbowlhelp.com/files/csv/importGenericSC.html) |
| `InventoryMove` | ImportInventoryMove | [Instructions](https://fishbowlhelp.com/files/csv/importInvMove.html) |
| `Kit` | ImportKitItems | [Instructions](https://fishbowlhelp.com/files/csv/importKitItems.html) |
| `Locations` | ImportLocations | [Instructions](https://fishbowlhelp.com/files/csv/importLocations.html) |
| `MemoData` | ImportMemoData | [Instructions](https://fishbowlhelp.com/files/csv/importMemoData.html) |
| `Part` | ImportPart | [Instructions](https://fishbowlhelp.com/files/csv/importPart.html) |
| `PartAndProductRenaming` | ImportPartAndProductRenaming | [Instructions](https://fishbowlhelp.com/files/csv/partAndProductRenaming.html) |
| `PartAndQty` | ImportPartAndQty | [Instructions](https://fishbowlhelp.com/files/csv/importPartAndQuantity.html) |
| `PartCost` | ImportPartCost | [Instructions](https://fishbowlhelp.com/files/csv/importPartCost.html) |
| `PartProductVendorPricing` | ImportPPVP | [Instructions](https://fishbowlhelp.com/files/csv/updatePPP.html) |
| `PartStandardCost` | ImportPartStandardCost | [Instructions](https://fishbowlhelp.com/files/csv/importPartStdCost.html) |
| `PartUOM` | ImportPartUOM | [Instructions](https://fishbowlhelp.com/files/csv/importPartUOM.html) |
| `PaymentData` | ImportPaymentData | [Instructions](https://fishbowlhelp.com/files/csv/importPayments.html) |
| `PaymentTerms` | ImportPaymentTerms | [Instructions](https://fishbowlhelp.com/files/csv/iePaymentTerms.html) |
| `PickingData` | ImportPickingData | [Instructions](https://fishbowlhelp.com/files/csv/importBCPicking.html) |
| `PackingData` | ImportPackingData | [Instructions](https://fishbowlhelp.com/files/csv/importPacking.html) |
| `PricingRules` | ImportPricingRules | [Instructions](https://fishbowlhelp.com/files/csv/importPricing.html) |
| `Product` | ImportProduct | [Instructions](https://fishbowlhelp.com/files/csv/importProduct.html) |
| `ProductPricing` | ImportProductPricing | [Instructions](https://fishbowlhelp.com/files/csv/productPricing.html) |
| `ProductTree` | ImportProductTree | [Instructions](https://fishbowlhelp.com/files/csv/importProductTree.html) |
| `ProductTreeCategories` | ImportProductTreeCategories | [Instructions](https://fishbowlhelp.com/files/csv/importProductTreeCategories.html) |
| `PurchaseOrder` | ImportPurchaseOrder | [Instructions](https://fishbowlhelp.com/files/csv/importPurchaseOrder.html) |
| `QBClass` | ImportQBClass | [Instructions](https://fishbowlhelp.com/files/csv/qbclass.html) |
| `ReceivingData` | ImportReceivingData | [Instructions](https://fishbowlhelp.com/files/csv/importBCReceiving.html) |
| `ReorderLevels` | ImportReorderLevels | [Instructions](https://fishbowlhelp.com/files/csv/reorderLevels.html) |
| `SalesOrder` | ImportSalesOrder | [Instructions](https://fishbowlhelp.com/files/csv/importSO.html) |
| `SalesOrderDetails` | ImportSalesOrderDetails | [Instructions](https://fishbowlhelp.com/files/csv/importSODetails.html) |
| `ScrapData` | ImportScrapData | [Instructions](https://fishbowlhelp.com/files/csv/importScrapData.html) |
| `ShipCartonTracking` | ImportShipCartonTracking | [Instructions](https://fishbowlhelp.com/files/csv/ieShipCartonTracking.html) |
| `ShippingData` | ImportShippingData | [Instructions](https://fishbowlhelp.com/files/csv/importShipping.html) |
| `TaxRates` | ImportTaxRates | [Instructions](https://fishbowlhelp.com/files/csv/importTaxRates.html) |
| `TransferOrder` | ImportTransferOrder | [Instructions](https://fishbowlhelp.com/files/csv/ieTransferOrder.html) |
| `UOM` | ImportUOM | [Instructions](https://fishbowlhelp.com/files/csv/exportUOM.html) |
| `UOMConversions` | ImportUOMConversions | [Instructions](https://fishbowlhelp.com/files/csv/exportUOMConv.html) |
| `Users` | ImportUsers | [Instructions](https://fishbowlhelp.com/files/csv/IEUser.html) |
| `VendorCostRules` | ImportVendorCostRules | [Instructions](https://fishbowlhelp.com/files/csv/importVendorCostRules.html) |
| `VendorParts` | ImportVendorParts | [Instructions](https://fishbowlhelp.com/files/csv/importVendorParts.html) |
| `Vendors` | ImportVendors | [Instructions](https://fishbowlhelp.com/files/csv/importVendor.html) |

You can also retrieve column headers at runtime from Fishbowl itself:

```javascript
// Get the official import headers from the server
var rq = FishbowlJSON.ImportHeaderRq({ Type: 'ImportPart' });
var rs = FB.legacyApi('IMPORT_HEADER', JSON.stringify(rq));
```

### Legacy JSON/XML API Documentation

The legacy API (used by `FishbowlJSON` factories and `FB.legacyApi()`) uses XML request/response types exposed as JSON through the bridge. Documentation resources:

| Resource | URL |
|---|---|
| **Legacy API download** (XSD schemas, examples) | https://help.fishbowlinventory.com/advanced/s/Legacy-API.zip |
| **REST API docs** (built into your Fishbowl Server) | `http://{server}:{port}/apidocs` (default port 2456) |
| **REST API example** (hosted) | https://help.fishbowlinventory.com/advanced/s/apidocs/introduction.html |
| **Postman collection** | Import from `https://fishbowlhelp.com/pm` |
| **Imports & Exports overview** | https://help.fishbowlinventory.com/advanced/s/article/Imports-and-Exports |

The Legacy API ZIP contains XSD schema files that define every request and response type. These are the same types registered in `FishbowlJSON` — for example, `PartGetRq` and `PartGetRs` are defined in the XSD and correspond to `FishbowlJSON.PartGetRq()`.

### Suggested import order

When setting up a new Fishbowl database, imports should be run in this order (dependencies must exist before dependents):

1. Units of Measure → UOM Conversions
2. Location Groups / Locations
3. Users / User Rights
4. Payment Terms → Carriers → Custom Fields
5. Vendors → Tax Rates → Customers
6. Customer Group Relations
7. Part Product and Vendor Pricing (PPVP)
8. Kit Items → Default Locations
9. Bill of Materials → Product Tree Categories → Product Tree
10. Pricing Rules
11. Add Inventory
12. Sales Orders → Purchase Orders

## Important notes for developers

### CSV date formats
Fishbowl CSV imports expect `MM/DD/YYYY` date format, not ISO `YYYY-MM-DD`.

### CSV import via fb.js
```javascript
var imp = FishbowlCSV.PurchaseOrder({ header: {...}, items: [...] });
var result = FB.importCSV('ImportPurchaseOrder', imp.toCSV());
```

The first argument to `FB.importCSV()` is the import type string (e.g., `ImportSalesOrder`, `ImportPart`), which matches the schema's `importType` property.

### DateLastModified precision bug
Fishbowl's `@Version` optimistic locking on `dateLastModified` causes Save* APIs (SavePick, SaveShipment, SaveWorkOrder) to fail because the API response truncates microseconds from the timestamp. Before saving, query the exact timestamp from the database and patch it:

```javascript
var pick = rs.Pick;
var dbTs = FB.query("SELECT dateLastModified AS dlm FROM pick WHERE num = :num", { num: pickNum });
pick.DateLastModified = dbTs[0].dlm;  // patch with exact DB timestamp
var saveRq = FishbowlJSON.SavePickRq({ Pick: pick });
FB.legacyApi(saveRq);
```

### Query parameter format
`FB.query()` parameters must be a flat object with string values and named `:placeholder` syntax:
```javascript
FB.query("SELECT * FROM part WHERE num = :num AND activeFlag = :active",
         { num: "B201", active: "1" });
```
