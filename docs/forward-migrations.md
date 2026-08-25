# Forward migrations

Persisted local state and exported backups carry an integer `schemaVersion`. Version 1 is the initial contract.

When the model changes:

1. Add a pure migration from every supported prior version to the next version.
2. Validate the input envelope before migration and never mutate the parsed source object.
3. Preserve unknown catalog identity fields where possible; never silently drop owner-specific fields.
4. Add a fixture and a test for the prior version, the migrated version, and an unsupported future version.
5. Keep export versioned and document the migration in this file.

The current restore path intentionally rejects unsupported versions. That fail-closed behavior prevents a newer backup from being mistaken for an older private-state shape.

The proposed change-set workflow is an additive schema alongside collection schema version 1. Its journal is optional in a backup, and a legacy backup without a journal restores to an empty change-set journal. Change sets themselves reject unknown fields and future schema versions; they are never silently migrated during approval.
