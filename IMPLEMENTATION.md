# Implementation state

The remote is a single federated React application exposed as `./App`. It follows
the shared EIA operational record design: the canonical `src/ui.css` is copied
from the shell, `src/EntityPicker.jsx` is copied from the UI kit, and the
workbench holds no business logic. Every action calls the domain service.

## Screens

| Screen | Behaviour |
|---|---|
| Notification queue | Lists notifications with number, subject, recipient, channel, and status; selecting one opens it and pushes `?record={id}` |
| Queue filter | Prominent client-side filter over number, subject, recipient party, channel, and status, with a result count, empty state, and Clear action |
| Source filter | URL `sourceType` + `sourceId` scope the queue through `GET /api/v1/notifications?sourceType=…&sourceId=…`, with a banner/chip, resolved reference, and a **Clear filter** action that reloads unfiltered |
| Create notification | Primary header action (`?new=1`); opens a compact dialog with a predictive recipient `EntityPicker` backed by `/api/v1/parties/search` and an optional source-record block (type, id, reference). Supports URL prefill for type, channel, recipient, subject, body, template, and source |
| Templates | Top-level section (switch beside Notifications) reading `GET /api/v1/notifications/templates`: code, version, locale, channel, status, approval, and updated columns with a client-side filter, count, and empty state. The approval-gate panel states that only ACTIVE approved templates can send |
| Create template | Dialog with code, version, locale, optional channel, and body; `POST /api/v1/notifications/templates` creates a DRAFT and the registry reloads |
| New template version | Row action on every template. Opens the same create dialog prefilled with the source row's code, locale, channel, and body and `version + 1`, with a "Based on vX" context card and a compact same-code version history. Creating posts the normal template payload and the new row is DRAFT |
| Approve template | DRAFT-only action; opens a typeahead over the public `GET /api/v1/directory` people by name/email, shows the selected person's name, role, email, teams, and directory id, and posts `{approvedBy}` with that id to `POST /api/v1/notifications/templates/{id}/approve`, then reloads. A directory failure or empty directory falls back to a manual approver id field |
| Retire template | DRAFT/ACTIVE-only action posting to `POST /api/v1/notifications/templates/{id}/retire`, then reloads |
| Overview | Notification facts including the linked source record, recipient party cross-links, the "Why this matters" delivery context panel, and related records for the source and recipient |
| Delivery | Record-level channel, status, recipient, scheduled, sent, delivered, and provider-reference state, plus the per-attempt delivery history loaded from `GET /api/v1/notifications/{id}/attempts` |
| Template | Bound template code/version and the rendered subject/body |
| Activity | Event-derived, append-only timeline read from `GET /api/v1/events/aggregate/{id}?limit=50` with `X-EIA-Tenant`: timestamp, readable event name, inbox status, record version, and payload facts (channel, recipient party, type, status). Card-local loading, empty, and error states; refreshes on demand and on selection |

## Record discovery

The remote reads `?record={id|notificationNumber}` and `?new=1` on mount and
listens for `popstate`. Selecting a notification, opening create, and closing
create update the address bar through `src/navigation.js` (`pushState` plus a
`PopStateEvent`, with `window.location.assign` as the fallback). `writeUrl` passes
`notify: false` because the workbench has already applied the state locally.

A notification number that is not in the loaded queue is resolved through
`GET /api/v1/notifications/search?q={number}&limit=10`, and the returned id is
selected so the canonical detail read loads the record. An id deep link is read
directly through `GET /api/v1/notifications/{id}`.

## Create prefill

`?new=1` accepts optional `notificationType`, `channel`, `recipientPartyId`,
`subject`, `body`, `templateCode`, `sourceType`, `sourceId`, and
`sourceReference` parameters. They seed the create dialog only when `new=1` is
present; `?record=` links ignore them. Values are validated before use: an
unknown type, channel, or source type falls back to the form default, and a
`recipientPartyId` that is not a UUID falls back to the seeded demo recipient
while the picker still shows it as selected. The type list includes
`DUNNING_NOTICE`. A source prefill keeps the supplied type/id pair and
reference; an incomplete or malformed pair is caught by the form validation
before any request is sent.

Prefill is applied when the dialog is opened from the URL, not on every render
or URL event. The initial mount seeds the draft; a later `popstate` only seeds
a closed dialog, so an already-open, edited draft is never overwritten. Opening
create normally always resets the form to the defaults and writes a `new=1`
URL without prefill parameters. Closing the dialog returns to `?record=`.

The queue filter is client-side over the loaded (optionally source-scoped) list; it does not call the
search endpoint. The create form resolves the recipient through
`/api/v1/parties/search?q={term}&limit=8`, displays the party number/name label,
and links to `/party?record={id}`. The Overview and Delivery tabs link the
recipient party at the same route.

## Source record linkage

A notification may carry a flat `sourceType`/`sourceId`/`sourceReference` link
to the business record that caused it. `src/source.js` owns the mapping:
`DIRECT_CLAIM` links to `/direct-claims?record={sourceId}`, `ASSUMED_CLAIM` to
`/assumed-claims?record={sourceId}`, `POLICY` to `/policy?record={sourceId}`,
`CONTRACT` to `/contract?record={sourceId}`, `PAYMENT` to
`/payment?record={sourceId}`, `CESSION` to `/cession?record={sourceId}`,
`RETROCESSION` to `/retrocession?record={sourceId}`, `DOCUMENT` to
`/document?record={sourceId}`, and `PARTY` to `/party?record={sourceId}`.
`OTHER` has no owning remote and stays plain text.
The human `sourceReference` is the link/text label when present; the short id is
the fallback and the full id stays visible under a reference so it can be
copied.

The Overview shows the source in the notification facts, the "Why this matters"
panel links it, and the related-records card links the source beside the
recipient party. A notification without a source shows `—` and no placeholder
claim about unavailable records.

The create dialog's optional source block has type, record id, and reference.
Type and id are all-or-nothing: a type without a UUID id, an id without a type,
a non-UUID id, or a reference longer than 64 characters is rejected in the
dialog before the POST. The payload adds whichever source fields were supplied
and omits them entirely for the common no-source notification. The same values
are accepted from `?new=1` prefill.

Errors keep the structured `CODE: message` format from the API problem body.
Create, send, and the problem-error paths are unchanged.

## Source-filtered queue

The listing URL accepts a `sourceType`/`sourceId` pair as a server-side filter, so a **View all**
hand-off from another vertical can use `/notifications?sourceType=POLICY&sourceId={id}` (or the
dev-server root). On load, and on a `popstate` that changes the pair, the queue calls
`GET /api/v1/notifications?sourceType=…&sourceId=…`; with no pair it calls the unfiltered list.

`src/source.js` owns parsing: the type is normalized against the closed set and the id must be a
UUID. A partial pair, an unknown type, or a malformed id resolves to no filter and a visible error,
so the workbench never sends half a pair (the API would reject it as `INVALID_SOURCE_FILTER`). The
unfiltered queue still loads so the screen remains usable.

A valid pair renders a banner/chip above the queue: the source type label plus the human
`sourceReference` found on a returned notification, falling back to the short source id (the full
id is the chip title). The client-side queue filter narrows within the scoped result. Selecting a
record writes `?record=…&sourceType=…&sourceId=…`, so refresh and back preserve the scope;
**Clear filter** deletes only those two parameters, keeps the selected record, and reloads the
unfiltered queue. `?new=1` is deliberately exempt: source parameters there remain create-draft
prefill and the queue loads unfiltered. Creating a notification outside the active scope clears the
scope so the new record is visible.

## Delivery attempts

The Delivery tab shows both the record-level delivery state and the per-attempt
history. The history loads as soon as a notification is selected (not only when
the tab is opened) from `GET /api/v1/notifications/{id}/attempts` with
`X-EIA-Tenant`, and refetches on **Refresh record**, after a send, and from the
card's own **Refresh** action. The attempt state is keyed by notification id:
while a selection change is in flight the card shows the new record's loading
state, never the previous record's attempts.

The table is oldest first by attempt number, and each row shows attempt number,
provider, status, provider reference, attempted time, and the failure text when
one exists. `src/attempts.js` normalizes the response and tolerates the API
projection returning a bare list or an object with an `items`/`attempts` list;
it also accepts the common field aliases (`attemptNo`/`sequence`,
`providerName`/`providerCode`, `reference`/`providerRef`, `attemptedAt`/
`createdAt`, `errorMessage`/`failureReason`/`errorCode`) so the record screen
does not depend on one spelling. Unknown or absent statuses show `UNKNOWN`, and
one malformed entry never discards the rest of the history.

The provider is labelled **Local simulated delivery**. The card states that the
notifications service simulates delivery locally, that provider references are
issued by the local simulator, and that no production provider adapter
(email/SMTP, SMS gateway, push, or webhook) is present in this slice. The same
note appears under the record-level Delivery table.

The card has its own loading, empty, and error states. A `CREATED` notification
with no attempts explains that it has not been sent and that the first attempt
is recorded when the send transition runs. An unavailable attempts projection
(the endpoint may 404 or 503 when the backend slice is absent) is contained in
the card: the record header, Overview, Template, and Activity tabs and the send
action keep working.

The record-level delivery evidence is carried on the notification itself:
`providerReference` and `deliveredAt` appear in the summary **Sent** card, in
the Overview **Notification details** (with `sentAt`), and as Delivered and
Provider reference columns in the record-level Delivery table.

## Template registry and approval gate

The **Templates** section is a top-level sibling of the notification queue. It
loads `GET /api/v1/notifications/templates` with `X-EIA-Tenant` and renders a
registry table, not a per-notification binding view: code, version, locale,
channel (optional, shown as "Any channel"), status, approval (the approver's
directory name when the directory has been read, otherwise the short id, plus
approved-at), and updated. The filter is client-side over code, version,
locale, channel, status, approval state, and the resolved approver name; it
reloads nothing.

A template is created through a dialog with code, version, locale, optional
channel, and body. The payload is `{templateCode, templateVersion, locale,
channel, bodyTemplate}` with `channel: null` when the optional field is blank,
and the new row is a DRAFT. Approval is available only on DRAFT rows. Retirement
is available on DRAFT and ACTIVE rows and posts to `/retire`. Every row,
including RETIRED rows, also keeps the New version action and no longer shows
an empty actions cell.

**New version** opens the same create dialog in place. Code, locale, channel
("Any channel" stays blank), and body are copied from the selected row, and the
version is the selected row's version + 1. Nothing is locked: every field can be
adjusted before the normal create request is sent, and the created row is
always a DRAFT. The dialog shows a "Based on v{X}" context card and a compact
history of every template sharing the source code, newest version first; the
list is capped at five rows but the source version is appended when it falls
outside the newest five. The history shows each version's locale, channel,
status, and which row the draft was copied from.

A client-side validation failure or a duplicate (409, for example
`EIA-NTF-9205` because the same code, version, and locale already exists) is
shown inside the dialog without closing it and without losing the prefilled
fields, so the user can correct the draft and resubmit. The success notice
names the base version.

Every create, approve, and retire response is merged into the table and then
the registry is reloaded, so the table reflects the server. Errors stay inside
the Templates section. A 409 on approval closes the approver dialog, shows the
structured `CODE: message`, and allows the reload to display the transition
that won; a failed list load shows the alert and an empty registry while the
notification queue remains usable. The section carries an explicit approval
gate note: only ACTIVE templates with an approval record can send, and the send
path re-checks the template on every send (NTF-01, NTF-14).

## Directory-backed approver

The approval dialog's approver is a directory person. The first time the dialog
opens, the app reads the public `GET /api/v1/directory` (`{people, teams}`) with
`src/directory.js`; the normalized people and teams are cached for the rest of
the session, a concurrent open joins the in-flight request, and later dialogs
reuse the cache without another read. The endpoint is public master data, so the
request omits the `X-EIA-Tenant` header (`api(path, {tenant: false})`).

`src/DirectoryPersonPicker.jsx` is a searchable typeahead over display name and
email. Focusing the field lists every person; typing narrows the list locally,
and the arrow keys, Enter, and Escape move through and close the list without
closing the dialog. Selecting a person replaces the field with the selected
name (role/email and directory id underneath) and a Change action, and a
"Directory person" context card adds role, email, team labels, and the
directory id so the approval identity is explicit.

The selected person's directory id is the approval identity: `submitApproval`
posts `{approvedBy: person.id}` to
`/api/v1/notifications/templates/{id}/approve` and the success notice names the
person (`Template {code} v{version} approved by {name}.`). Directory ids are
stable public identifiers such as `a-adjuster`, so the field no longer requires
a UUID; the manual fallback accepts the same id shape.

A directory 503 (or any lookup failure) is contained in the dialog: the context
explains the failure, the typeahead is replaced by a plain approver id input,
and approval still posts `{approvedBy}`. An empty people list takes the same
fallback. Failures are never cached, so reopening the dialog retries; a
successful directory read is cached.

## Tests

`tests/notifications.spec.js` covers the operational layout, create payload,
send transition, and problem errors. `tests/discovery.spec.js` covers `?record=`
selection and `popstate`, deep-link discovery through the search projection,
`?new=1`, prefill for the six base create parameters, partial prefill, an invalid
recipient UUID, plain `?new=1`, edited/normal create opens, prefill parameters on
a record link, queue filtering and clearing, the recipient picker request/payload
and label/link, and the delivery context/cross-links. `tests/source.spec.js`
covers the source link for every classified type (href and real navigation),
`OTHER` and no-reference text fallbacks, source prefill, source create payload,
the type/id pair validation and UUID check, and omission of source fields for a
no-source draft. `tests/source-filter.spec.js` covers the
`/notifications?sourceType=…&sourceId=…` view-all hand-off, the filtered list
request and banner reference, clear/reload, record selection and back
navigation, partial/unknown/malformed pair rejection without a half-pair
request, the short-id fallback, and `?new=1` staying a create prefill instead
of a queue filter. `tests/activity.spec.js`
covers the event-timeline path/limit/tenant header, newest-first rendering,
payload facts, the empty state, a contained 503, explicit refresh, and refetch
when another notification is selected. `tests/attempts.spec.js` covers the
attempts path and tenant header fetched on record open, the attempt
number/provider/status/reference/attempted/error columns, local-simulated
provider labelling and the production-adapter note, refetch when another
record is opened, the CREATED empty state, a contained 503 with an explicit
retry, and `providerReference`/`deliveredAt` in the Sent card, Overview
details, and record-level Delivery table. `tests/templates.spec.js` covers the
registry list, table columns, approval-gate context, action availability, and
filter; create payload and DRAFT result; form validation and the optional
channel as `null`; new-version prefill of code, locale, channel, body, and
version + 1 from the API-shaped `code`/`version`/`bodyTemplate` response; the
same-code history order and source marker; editing the cloned body; duplicate
409 and validation errors contained in the dialog; the corrected DRAFT create;
directory approver required, searched by email, selected person context and
`{approvedBy}` payload, success notice with the recorded name, retirement, and
a 409 approval conflict that reloads the winning state; and a contained
list-load failure that leaves the notification queue usable.
`tests/approver-directory.spec.js` covers the one-time directory request and
cache (a second dialog open reads nothing new), name and email search, keyboard
selection, the selected-person context and approval payload, the directory 503
fallback with manual approver entry and retry on reopen, and the empty-directory
fallback with the required-approver validation. Run with `npm test`; the
Playwright config starts the dev server on port 3010.

## Remaining gaps

- Delivery is served by a local simulated provider adapter. A production
  provider adapter (email/SMTP, SMS gateway, push, or webhook) is not wired
  into this slice, so provider references are simulator-issued. The Activity
  tab surfaces emitted notification events separately from delivery attempts.
- Pagination, optimistic concurrency headers, and idempotency keys are not used
  by the remote. The template registry loads the full list and the new-version
  dialog derives its short history from that list; create uses the server's
  unique constraint and surfaces a duplicate as a 409.
- No accessibility audit beyond semantic labels, tab state, and live regions.
