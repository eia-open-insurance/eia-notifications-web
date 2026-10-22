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
| Create notification | Primary header action (`?new=1`); opens a compact dialog with a predictive recipient `EntityPicker` backed by `/api/v1/parties/search`. Supports URL prefill for type, channel, recipient, subject, body, and template |
| Overview | Notification facts, recipient party cross-links, the "Why this matters" delivery context panel, and a related-records note |
| Delivery | Record-level channel, status, recipient, scheduled, and sent state |
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
`subject`, `body`, and `templateCode` parameters. They seed the create dialog
only when `new=1` is present; `?record=` links ignore them. Values are
validated before use: an unknown type or channel falls back to the form
default, and a `recipientPartyId` that is not a UUID falls back to the seeded
demo recipient while the picker still shows it as selected. The type list
includes `DUNNING_NOTICE`.

Prefill is applied when the dialog is opened from the URL, not on every render
or URL event. The initial mount seeds the draft; a later `popstate` only seeds
a closed dialog, so an already-open, edited draft is never overwritten. Opening
create normally always resets the form to the defaults and writes a `new=1`
URL without prefill parameters. Closing the dialog returns to `?record=`.

The queue filter is client-side over the loaded list; it does not call the search
endpoint. The create form resolves the recipient through
`/api/v1/parties/search?q={term}&limit=8`, displays the party number/name label,
and links to `/party?record={id}`. The Overview and Delivery tabs link the
recipient party at the same route. The notification DTO exposes no source
business record, so the context panel says so explicitly and the workbench does
not invent claim, policy, or payment links.

Errors keep the structured `CODE: message` format from the API problem body.
Create, send, and the problem-error paths are unchanged.

## Tests

`tests/notifications.spec.js` covers the operational layout, create payload,
send transition, and problem errors. `tests/discovery.spec.js` covers `?record=`
selection and `popstate`, deep-link discovery through the search projection,
`?new=1`, prefill for all six parameters, partial prefill, an invalid recipient
UUID, plain `?new=1`, edited/normal create opens, prefill parameters on a
record link, queue filtering and clearing, the recipient picker request/payload
and label/link, and the delivery context/cross-links. `tests/activity.spec.js`
covers the event-timeline path/limit/tenant header, newest-first rendering,
payload facts, the empty state, a contained 503, explicit refresh, and refetch
when another notification is selected. Run with `npm test`; the Playwright
config starts the dev server on port 3010.

## Remaining gaps

- The Notifications API exposes delivery only at record level; per-attempt
  delivery history and the source business record are not available in this
  slice. The Activity tab surfaces emitted notification events, not delivery
  attempts.
- Pagination, optimistic concurrency headers, and idempotency keys are not used
  by the remote.
- No accessibility audit beyond semantic labels, tab state, and live regions.
