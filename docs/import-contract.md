# Workbook import contract

The importer is preview-first and browser-local. `readWorkbookFile` reads the selected file into memory, and no importer code calls `fetch`, a database client, or an upload endpoint.

Recognized sheets are case-insensitive aliases:

- Inventory: `Inventory`, `Owned`, `Collection`, `Holdings`
- Wants: `Wants`, `Wanted`, `Wishlist`
- Box roadmap: `CAJAS_MASTER`, `Cajas`, `Box Master`
- Tin/display roadmap: `TINS_MASTER`, `Tins`, `Latas Master`

For `CAJAS_MASTER` and `TINS_MASTER`, the first fifteen rows are inspected for the real header row, so an introductory block above row 6 is preserved in row-level reporting rather than interpreted as data.

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

The roadmap sheets additionally map their Spanish fields for order, year, code, target language, segment, tier, urgency, keep/open goals, current sealed/opened units, price ceiling/status/date, recommended action, and Cardmarket source. Each roadmap proposal stores separate sealed and opened targets and holdings. Optional openings remain visible bonus goals but do not block required completion.

Cardmarket category, search, seller, and offer URLs are never treated as exact products. After preview, a roadmap label may receive a stable official `idProduct` only through the checked-in public index and only when its normalized name/type has one conservative unique match; otherwise Pocketdex keeps a safe Cardmarket search link.

Rows without a name or object type are actionable ambiguities; a missing type is never inferred as a single card. New imports accept only non-single product types. Individual and graded-card rows are explicitly skipped, while compatible historical records remain readable and exportable through backup/restore. Invalid quantities are skipped. Every row, including rows from unrecognized sheets, receives a decision in the preview. Duplicate normalized identities are consolidated by deterministic record ID, making a repeated apply idempotent rather than additive.

The preview exposes SHA-256 hashes before and after normalization. The source byte array is copied before hashing and is never written back to disk.
