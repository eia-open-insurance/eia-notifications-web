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
- Recipient cross-link resolution through `GET /api/v1/parties/{id}`: the header, Overview,
  Delivery, and context panel show `name · party number` link text with a short-UUID fallback, and
  a 404 never blocks the record.
- Notification activity timeline: an **Activity** tab after **Template** renders
  `GET /api/v1/events/aggregate/{notificationId}?limit=50` scoped by `X-EIA-Tenant`. Selecting a
  notification fetches the card; rows show the occurred-at timestamp, a readable event name plus
  the raw event type, inbox status, record version, and payload facts (channel, recipient party,
  type, and status transition). The card states that activity is event-derived and append-only and
  that the notification record remains the source of truth, keeps loading, empty, and error
  states inside the card, refreshes on demand, and refetches when another notification is
  selected or after a send. A 503 from the event service never blocks the notification record.
- Playwright activity coverage for the aggregate path/limit/tenant header, newest-first
  ordering, payload summaries, the empty state, a contained 503, explicit refresh, and refetch
  when another notification is selected.
