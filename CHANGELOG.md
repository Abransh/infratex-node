# Changelog

**API parity.** Every release lists the API changes it covers, each with the section of the
[API docs](https://docs.infratex.io) it matches, and anything public it does not cover yet. The
Node.js and Python SDKs ship the same API changes under the same version number.

## 1.1.0 (unreleased)

### Added

- `pipeline` (`'legacy'` | `'v2'`) on `extractions.create(...)`, sent in the JSON body only when
  set (never as a query parameter), with the `ExtractionPipeline` type. API docs: Extraction,
  "v2 (beta)" and the `pipeline` row of `POST /api/v1/documents/{id}/extractions`.
- `InvalidPipelineError` (422 `invalid_pipeline`) and `PipelineNotAvailableError`
  (422 `pipeline_not_available`), extending `InfratexError`, with `allowedPipelines`,
  `requestedPipeline` and `availablePipelines` read from the error details. API docs:
  Extraction, "v2 (beta)"; Reference, Errors (422).
- `extractions.listPipelines()` for `GET /api/v1/extraction-pipelines`
  (`ExtractionPipelinesResponse`). API docs: Extraction, "v2 (beta)".
- `ExtractionRun.pipeline`, `credits_charged`, `engine_version` and `cached`. API docs:
  Extraction, `GET /api/v1/extractions/{run_id}`.
- `'infratex-phi'` in the `ExtractionModel` type. API docs: Extraction, "Self-hosted extraction
  (infratex-phi)".
- `extractions.createFromFile(file, options)` for `POST /api/v1/extractions` (parse and extract in
  one call: the run body, `method` and a server-side `wait`). API docs: Extraction,
  `POST /api/v1/extractions`.
- `wait` (0 to 300 seconds) on `extractions.get(...)`. API docs: Extraction,
  `GET /api/v1/extractions/{run_id}`.
- `idempotency_key` on `documents.upload`, `documents.uploadImages`, `documents.index`,
  `extractions.create` and `extractions.createFromFile`, sent as the `Idempotency-Key` header.
  API docs: Reference, "Retries and idempotency".
- `options` (`infratex-gamma` parse options, typed as `ParseOptions`, sent as one JSON object) on
  `documents.upload` and `documents.uploadImages`. API docs: Parsing, `POST /api/v1/documents`
  and "Parse options (infratex-gamma)".
- `documents.layout(id)` for `GET /api/v1/documents/{id}/layout` (`DocumentLayout`,
  `DocumentLayoutPage`). API docs: Parsing, `GET /api/v1/documents/{id}/layout`.
- `account.updateSettings({ data_residency })` for `PATCH /api/v1/account/settings`, and
  `AccountSettings.data_residency`. API docs: Reference, "Data processing location".
- `client.webhooks`: `create`, `list`, `get`, `update`, `delete`, `rotateSecret`, `test`,
  `listDeliveries` and `retryDelivery`, with the `Webhook*` types. API docs: Webhooks.
- `verifyWebhookSignature(secret, body, header)`, plus the `SIGNATURE_HEADER` and
  `EVENT_ID_HEADER` names. API docs: Webhooks, "Signatures".
- `InfratexError.requestId` (the request's id, from the error body or `X-Request-ID`) and
  `InfratexError.retryAfter` (the `Retry-After` header in seconds). API docs: Reference,
  "Retries and idempotency".

### Fixed

- Errors are read from the API's error envelope (`{"error": {"code", "message", "details",
  "request_id"}}`). Before, `InfratexError.code` was `undefined` and the message was
  `Request failed with status N` for every error the API raised itself; the top-level
  `{"code", "message"}` and `{"detail": ...}` shapes are still read. A request validation
  error's list of field errors is under `details.errors`.
- `instanceof` works for subclasses of `InfratexError` (the constructor no longer resets the
  prototype to `InfratexError.prototype`).

### Not covered yet

- The `Idempotent-Replayed: true` response header is not surfaced: a replayed response returns
  the same object as the first one.
- `GET /api/v1/usage` is reachable with an API key but is not in the public API docs yet; it
  will be added in the release that follows its documentation.

## 1.0.0 (2026-10-20)

Announced on 20 October as 0.10.0. That version number was never published: the release
shipped as 1.0.0, so npm goes 0.9.0, 1.0.0.

### Added

- `documents.upload(...)` accepts Word `.docx` files. The uploaded Blob's type now follows
  the filename (`application/pdf`, the Word `wordprocessingml` type, or
  `application/octet-stream`) instead of always `application/pdf`. A Buffer passed without
  a filename is named `upload.docx` when its bytes are a ZIP package.
- `infratex-gamma` parse method (layout-aware OCR, 1 credit/page).
- `table_format` (`'otsl'` | `'html'`) on `documents.upload(...)` and
  `documents.uploadImages(...)`, and a new `documents.markdown(id, { table_format })` option.
- `figure_descriptions` on `documents.markdown(...)`, sent only when set so servers without
  the parameter are unaffected.
- `documents.listFigures(id)` and `documents.downloadFigure(id, name)` for the figure crops
  of a parsed PDF, with `DocumentFigure` / `DocumentFiguresResponse` types.
- `completeness` (`'standard'` | `'exhaustive'`) on `extractions.create(...)`, and
  `ExtractionRun.completeness`.
- `billing.listTransactions(...)` and the async iterator `billing.iterTransactions(...)` for
  the credit ledger (`GET /api/v1/billing/transactions`).
- New exported types: `TableFormat`, `MarkdownOptions`, `DocumentFigure`,
  `DocumentFiguresResponse`, `ExtractionCompleteness`, `BillingTransactionListOptions`,
  `BillingTransactionIterateOptions`, `BillingTransactionPage`.
- Test suite (`npm test`, node:test with mocked fetch) and `npm run typecheck`.

### Changed

- The README parse-method table matches the current methods and credit prices.

### Fixed

- `ExtractionTier` includes `'C'` (auto-chunked runs on large un-indexed documents), which
  the API already returns.
- `package-lock.json` carried version 0.8.1 while `package.json` was at 0.9.0; both now
  read 1.0.0.
