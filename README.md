# eia-notifications-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-notifications-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Notifications
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Notifications federated remote: screens, widgets, record tabs, and transaction composition. Notification rules, templates, routing, delivery, escalation, and acknowledgement.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## Implemented first slice

- React 19 and React DOM only at runtime; Webpack 5 Module Federation remote `eia_notifications` exposing `./App`.
- Async bootstrap (`index.jsx` loads `bootstrap.jsx`, which mounts React).
- Dev server port **3010**, proxying `/api` to `http://localhost:8100`.
- Workbench lists notifications, creates a draft, and sends a notification through the domain API with `X-EIA-Tenant`.
- Shared EIA operational record design: page head, notification queue, record header, summary grid, and
  Overview/Delivery/Template/Activity tabs; create is a dialog.
- URL record discovery: `?record={id|number}` opens a notification, `?new=1` opens the create dialog,
  and `popstate` keeps the workbench in step with shell navigation. A notification number missing from
  the loaded queue is resolved through `/api/v1/notifications/search`.
- Source-scoped queue: `sourceType` + `sourceId` on the listing URL (for example the
  `/notifications?sourceType=POLICY&sourceId=<policyId>` hand-off used by other verticals' **View
  all** links) become `GET /api/v1/notifications?sourceType=…&sourceId=…`. A banner/chip shows the
  source type and the human reference resolved from the returned notifications (short id fallback),
  record selection keeps the pair in the URL, and **Clear filter** removes the pair and reloads the
  unfiltered queue. A partial, unknown, or malformed pair is reported and never sent as half a pair;
  `?new=1` still treats the same parameters as create prefill and leaves the queue unfiltered.
- Prefilled create links: `?new=1` also accepts `notificationType`, `channel`, `recipientPartyId`,
  `subject`, `body`, `templateCode`, `sourceType`, `sourceId`, and `sourceReference`; invalid enum
  values and non-UUID recipients fall back to the defaults, `?record=` ignores them, and an edited or
  normally opened draft is never overwritten. `DUNNING_NOTICE` is available in the notification type
  list. A classified source requires both `sourceType` and a UUID `sourceId`; the reference is
  optional.
- Prominent client-side queue filter over notification number, subject, recipient party, channel, and
  status, with a result count and Clear action.
- Predictive recipient party selection in the create form, backed by `/api/v1/parties/search`, with
  the party number/name label and a `/party?record=` cross-link.
- Overview recipient party cross-links, a source-record link, a "Why this matters" delivery context
  panel, and related records that link the source and the recipient. `DIRECT_CLAIM`, `ASSUMED_CLAIM`,
  `POLICY`, `CONTRACT`, `PAYMENT`, `CESSION`, `RETROCESSION`, `DOCUMENT`, and `PARTY` sources open
  `/direct-claims`, `/assumed-claims`, `/policy`, `/contract`, `/payment`, `/cession`,
  `/retrocession`, `/document`, and `/party` with `?record={sourceId}`; `OTHER` stays plain text. The
  human `sourceReference` is shown whenever the API supplies it.
- Activity tab reads `GET /api/v1/events/aggregate/{notificationId}?limit=50` with the tenant header
  and renders an event-derived, append-only timeline: timestamp, readable event name plus the raw
  type, inbox status, record version, and payload facts (channel, recipient party, type, status).
  The card refetches on selection, has card-local loading/empty/error states, refreshes on demand,
  and a 503 never blocks the notification record.
- `@swc/core` is pinned to exactly `1.10.7`.
- Playwright tests mock the API and cover list + detail, create, send, problem errors, URL discovery,
  create prefill (full, partial, invalid recipient, plain `new=1`, and no overwrite after an edit),
  queue filtering, the recipient picker payload, source links for every classified type, `OTHER` as
  text, source prefill/create/validation, the source-scoped queue (filtered request, banner and
  reference, clear/reload, record selection and popstate, partial/invalid pair rejection, short-id
  fallback, and `new=1` staying unfiltered), and the delivery context/cross-links.
- Playwright activity coverage for the aggregate path/limit/tenant header, newest-first order,
  payload facts, empty and 503 states, explicit refresh, and selection refetch.
- Top-level **Templates** section backed by `GET /api/v1/notifications/templates`: a registry table
  with code, version, locale, channel, status, approval (approver and approved-at), and updated
  columns, plus a client-side filter, result count, and empty state.
- Create template dialog (`POST /api/v1/notifications/templates`) with code, version, locale,
  optional channel, and body; the registry creates the row as `DRAFT` and reloads it from the API.
- **New version** action on every template row (including `RETIRED` rows) opens the same create
  dialog prefilled with the source `code`, `locale`, optional channel, and body, with the version set
  to the source version + 1. A "Based on vX" context card and a compact same-code version history
  (newest first, with the source marked) frame the draft, and every field stays editable. Validation
  and duplicate 409 responses stay inside the dialog, and the created row is `DRAFT`.
- Approve action (`POST .../templates/{id}/approve`) for `DRAFT` rows opens an approver dialog and
  requires a valid approver UUID. Retire (`POST .../templates/{id}/retire`) is available for `DRAFT`
  and `ACTIVE` rows only. Every transition reloads the registry, and a 409 conflict is shown in the
  section while the table catches up to the server's winning state.
- Visible approval-gate context: only `ACTIVE` templates with an approval record can send
  notifications; `DRAFT` and `RETIRED` templates remain visible for administration and audit.
- Playwright template coverage for listing and filtering, approval-gate context and action
  availability, create payload (`DRAFT`, optional channel as `null`), validation, new-version
  prefill/version + 1/payload/create, same-code history ordering and source marker, duplicate 409
  and validation errors contained in the dialog, approver UUID validation, approve, retire, a
  contained 409 with reload, and a contained list-load failure.

## Local verification

```powershell
npm install
npm run build
npm test
```

`npm start` serves the remote at `http://localhost:3010`; `remoteEntry.js` is emitted by the production build.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
