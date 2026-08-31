# Product media

Pocketdex keeps product media optional. Every atlas node and gallery card has an original procedural fallback, so the roadmap remains complete, attractive, and offline-capable with no external image request.

## Owner photos

The mission sheet accepts JPEG, PNG, and WebP files up to 20 MB. Before storage, the browser validates the decoded dimensions, rejects images above 12,000 px on either edge or 40 million pixels, scales the longest edge to at most 1,024 px, and re-encodes to WebP. The resulting asset must remain below 4 MB. Canvas re-encoding discards EXIF and other source metadata.

Normalized files live in IndexedDB under `record:<stableRecordId>`. The collection model, audit journal, and change sets never contain image blobs. Replacing or removing a photo is local and explicit.

## ZIP image packs

`Base → Galería local` accepts a ZIP whose image filenames (without extension) match one of these identities:

1. Cardmarket `idProduct`;
2. catalog `variantKey`;
3. stable local record id;
4. the full `record:<id>` media key.

Only one JPEG, PNG, or WebP may match each record. Pocketdex checks file signatures, safe paths, file count, compressed and expanded sizes, then normalizes every matched candidate before atomically replacing the affected media set. Unmatched filenames are reported and left unused.

## Backups

- JSON is the lightweight collection and audit backup. It never contains media.
- The full ZIP contains `backup.json`, `media-manifest.json`, and numbered WebP files. Restore validates the complete archive before mutation and rolls collection, journal, and gallery back if one replacement fails.
- Clearing the device deletes the IndexedDB gallery before removing collection and audit storage.

## Licensed packshots

Repository-distributed packshots belong under `public/product-media/` and require a matching entry in `src/data/product-media-manifest.ts`. Each entry records a local WebP path, original HTTPS source, licence, optional licence URL, and attribution. The manifest starts empty by design.

Google Images is a discovery tool, not a source licence. A maintainer must follow the result to its host, verify that the stated licence applies to the exact file and permits the intended reuse, preserve required attribution, and keep evidence. Pokémon and marketplace imagery must be treated as copyrighted unless the rightsholder explicitly grants the necessary reuse rights. Pocketdex never scrapes or hotlinks those services.
