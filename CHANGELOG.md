# Changelog

## 0.1.3

- Add coverage for case-insensitive container/template association, icon format validation, upload size limits, path safety, and failed template-write preparation.

## 0.1.2

- List current Docker containers first and omit stale historical templates.
- Associate deployed containers with editable Unraid templates by name or template filename.
- Keep deployed containers without a template visible as read-only and reject non-deployed template writes.
- Keep Docker Compose-labelled containers read-only and require a current editable association for rollback.

## 0.1.1

- Fix Docker Hub release tags to publish `vX.Y.Z` and `vX.Y` as documented.
- Declare React runtime packages as production dependencies so container builds are reproducible.

## 0.1.0

- Initial public release with bulk icon changes, uploads, URL icons, groups, audits, and rollback.
