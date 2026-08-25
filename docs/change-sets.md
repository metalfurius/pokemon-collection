# Proposed change-set contract

Proposed updates use a separate `pokemon-collection-proposed-change-set` schema version 1. The collection and backup schema remains version 1 so existing exports continue to restore. A change set is an owner-reviewed, exact-record proposal with:

- the exact owner UID boundary, stable catalog identity, record ID, base state/record revisions, and an idempotency key;
- bounded, allow-listed operations with explicit before/after values;
- an expected result, synthetic/public source evidence, and an integrity hash;
- a safe inverse only for reversible holding, want, notes, and newly-created record operations.

The browser surface prepares a proposal, displays its diff, and requires the exact synthetic owner context to approve selected operations. Atomic approval applies every operation or none. Partial approval is explicit and records the selected operation IDs. A stale state/record revision, ambiguous target, changed before value, replayed key, tampered payload, unknown field, unsupported schema, oversized payload, or cross-owner context fails closed without a collection mutation.

Acquisition facts and price observations are append-only. New price observations must carry source URL and snapshot date, observed date, currency, language, edition, packaging, condition/sealed state, price kind, shipping treatment, sample information, confidence, and an explicit valued/unvalued status. Insufficient evidence is represented as `valuationStatus: "unvalued"` with no amount. No marketplace HTML is fetched and no background refresh or write path exists.

The journal is local-first and is included in new backups as an optional field. Legacy backups without a journal remain valid. Future Firestore adapters should store change-set and audit documents as prefixed documents directly under the valid `owners/{uid}/private` collection path; the rules expose only exact-owner access there. The local synthetic context is not a production authentication mechanism.
