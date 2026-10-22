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
- Delivery context panel and recipient cross-links.
- Notification source links. The Overview lists the notification's `sourceType`/`sourceId`/
  `sourceReference`; `DIRECT_CLAIM` and `ASSUMED_CLAIM` link to `/direct-claims` and
  `/assumed-claims`, `POLICY` to `/policy`, `CONTRACT` to `/contract`, and `PAYMENT` to `/payment`,
  each with `?record={sourceId}`. `OTHER` and a reference without a classified record stay plain
  text. The human `sourceReference` is shown when present, with the short id as fallback and the
  full id visible for copying. The "Why this matters" panel and related-records card now link the
  source and no longer claim the source record is unavailable.
- Create notification source block: optional source type, record id, and reference. Type and id are
  all-or-nothing and the id must be a UUID; the reference is optional and limited to 64 characters.
  Supplied source values are added to the create payload and omitted when the draft has no source.
  `?new=1` also accepts `sourceType`, `sourceId`, and `sourceReference` prefill parameters.
- Playwright source coverage for every classified link (href and navigation), `OTHER` and
  no-reference text fallbacks, source prefill, source create payload, type/id pair validation, the
  UUID check, and omission of source fields for a no-source draft.
- Expanded notification source linkage to the backend's full closed set: `CESSION`, `RETROCESSION`,
  `DOCUMENT`, and `PARTY` are selectable in the create dialog and link to `/cession`,
  `/retrocession`, `/document`, and `/party` with `?record={sourceId}`. Their labels participate in
  source-filter parsing and create validation. Playwright coverage exercises every classified link
  (including the four new types), the expanded create options and payload, and a `CESSION` queue
  filter.
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
- Create template dialog posting `{templateCode, templateVersion, locale, channel, bodyTemplate}`
  (channel optional and sent as `null`) to create a DRAFT, with client-side validation for code,
  version, locale, and body.
- New-version action on every template row, including RETIRED rows. It opens the same create dialog
  prefilled with the source code, locale, optional channel, and body, and sets the version to the
  source version + 1. The dialog shows a "Based on vX" context card and a compact same-code version
  history (newest first, source marked), and every field remains editable. Validation and duplicate
  409 responses stay inside the dialog; the created row is DRAFT and the success notice names the
  base version.
- Approve action for DRAFT templates through an approver UUID dialog (`approvedBy`), and retire for
  DRAFT/ACTIVE templates. Actions reload the registry; approval and retirement responses are merged
  first, and a 409 conflict is contained in the section while the reload shows the winning state.
- Playwright template coverage for list/filter, gate context and action availability, create payload
  and DRAFT result, validation, new-version prefill/version + 1/payload/create, same-code history
  ordering and source marker, duplicate 409 and validation errors contained in the dialog, approver
  UUID validation, approve, retire, contained 409 with reload, and a contained registry load
  failure.
- Source-scoped notification queue: `/notifications?sourceType=…&sourceId=…` (and the root route)
  loads `GET /api/v1/notifications?sourceType=…&sourceId=…`. A filter banner/chip shows the source
  type plus the human reference resolved from the filtered rows (short id fallback), selecting a
  record keeps the pair in the URL, and **Clear filter** removes only the pair and reloads the
  unfiltered queue. A partial, unknown, or malformed pair shows an error and loads the queue without
  sending half a pair; `?new=1` keeps the parameters as create prefill and never filters the queue.
  Playwright coverage for the `/notifications` view-all hand-off, the filtered request and banner,
  clear/reload, record selection and back navigation, partial/invalid pairs, the short-id fallback,
  and the `?new=1` non-filter path.
