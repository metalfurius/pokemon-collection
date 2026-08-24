# Workbook import contract

The importer is preview-first and browser-local. `readWorkbookFile` reads the selected file into memory, and no importer code calls `fetch`, a database client, or an upload endpoint.

Recognized sheets are case-insensitive aliases:

- Inventory: `Inventory`, `Owned`, `Collection`, `Holdings`
- Wants: `Wants`, `Wanted`, `Wishlist`

Recognized columns are case-insensitive and tolerate spaces, hyphens, and underscores:

| Meaning | Accepted headers |
| --- | --- |
| Name | `Name`, `Item`, `Card`, `Title`, `Catalog Name` |
| Type | `Type`, `Object Type`, `Category`, `Kind` |
| Set | `Set`, `Set Name`, `Expansion`, `Series` |
| Number | `Number`, `Card Number`, `No`, `Collector Number` |
| Quantity | `Quantity`, `Qty`, `Count`, `Amount` |
| Status | `Status`, `State` |
| Condition | `Condition`, `Quality` |
| Language | `Language`, `Lang` |
| Grading company | `Grading Company`, `Grader`, `Grading`, `Company` |
| Grade | `Grade`, `Score` |
| Want priority | `Priority`, `Want Priority` |
| Notes | `Notes`, `Note`, `Comment` |

Rows without a name or with an unsupported type are ambiguous. Invalid quantities are skipped. Every row, including rows from unrecognized sheets, receives a decision in the preview. Duplicate normalized identities are consolidated by deterministic record ID, making a repeated apply idempotent rather than additive.

The preview exposes SHA-256 hashes before and after normalization. The source byte array is copied before hashing and is never written back to disk.
