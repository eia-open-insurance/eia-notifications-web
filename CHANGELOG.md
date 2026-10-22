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
- Prefilled create links: `?new=1` accepts optional `notificationType`, `channel`,
  `recipientPartyId`, `subject`, `body`, and `templateCode` query parameters and seeds the create
  dialog from them. A recipient that is not a UUID, or an unknown type or channel, falls back to
  the form default; `?record=` links ignore prefill parameters. An edited draft is never reseeded
  by a URL re-application, and opening create normally always starts from the defaults.
  `DUNNING_NOTICE` is available in the notification type list.
- Playwright prefill coverage for all six parameters, partial prefill, an invalid recipient UUID,
  plain `?new=1`, edited/normal opens, and prefill parameters on a record link.
- Top-level Templates section reading `GET /api/v1/notifications/templates`: registry table (code,
  version, locale, channel, status, approval with approver/approved-at, updated), client-side
  filter, result count, and empty state. The section states the approval gate: only ACTIVE
  templates with an approval record can send notifications.
- Create template dialog posting `{templateCode, templateVersion, locale, channel, body}` (channel
  optional and sent as `null`) to create a DRAFT, with client-side validation for code, version,
  locale, and body.
- Approve action for DRAFT templates through an approver UUID dialog (`approvedBy`), and retire for
  DRAFT/ACTIVE templates. Actions reload the registry; approval and retirement responses are merged
  first, and a 409 conflict is contained in the section while the reload shows the winning state.
- Playwright template coverage for list/filter, gate context and action availability, create payload
  and DRAFT result, validation, approver UUID validation, approve, retire, contained 409 with
  reload, and a contained registry load failure.
