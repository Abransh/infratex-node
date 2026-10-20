# Changelog

## 1.0.0

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
