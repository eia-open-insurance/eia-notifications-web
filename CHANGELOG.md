# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- URL record discovery: `?record={id|number}` selects a notification, `?new=1` opens the create
  dialog, and `popstate` re-applies the URL. Notification numbers outside the loaded queue are
  resolved through `/api/v1/notifications/search`.
- Client-side notification queue filter over number, subject, recipient party, channel, and status,
  with a result count, empty state, and Clear action.
- Predictive recipient party lookup backed by `/api/v1/parties/search`, showing the party
  number/name label and linking to `/party?record={id}`.
- Delivery context panel and recipient cross-links. The source business record is explicitly
  described as unavailable in this API slice instead of being invented.
- Shared canonical `ui.css` and copied `EntityPicker.jsx`; shell-aware `navigate`/`recordHref`
  helpers for cross-vertical links.
- Playwright discovery coverage for URL state, queue filtering, the party picker payload, and the
  delivery context/cross-links.
