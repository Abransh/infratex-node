# Infratex Node.js SDK

Official Node.js / TypeScript SDK for the [Infratex](https://infratex.io) document intelligence API.

- Parse PDFs, Word documents, or ordered image batches into structured Markdown
- Build vector and hybrid search indexes
- Retrieve cited context and stream grounded AI answers
- Extract structured fields from documents
- Receive signed webhooks when work finishes

Requires **Node.js 18+**. Zero runtime dependencies — uses the native `fetch` API.

## API parity

Every public endpoint and request parameter in the [API docs](https://docs.infratex.io) is
available from this SDK, and every API error code reaches you in `InfratexError.code`. Each
release lists the API changes it covers in [CHANGELOG.md](CHANGELOG.md), next to the API docs
section each change matches, along with anything not covered yet. The Python SDK
(`pip install infratex`) ships the same changes under the same version number.

## Install

```bash
npm install infratex
```

## Quick start

```typescript
import Infratex from 'infratex';

const client = new Infratex({ apiKey: 'infratex_sk_...' });

// Upload and parse a PDF (waits for parsing by default)
const doc = await client.documents.upload('./report.pdf', { method: 'standard' });
console.log(doc.id, doc.page_count, 'pages');

// Index for retrieval, then wait until it's ready
await client.documents.index(doc.id, { method: 'hybrid' });

// Stream a cited answer
const stream = await client.responses.create({
  message: 'Summarize the key findings with citations.',
  method: 'hybrid',
  model: 'fast',
  document_ids: [doc.id],
});

for await (const event of stream) {
  if (event.type === 'sources') console.log('Sources:', event.content);
  if (event.type === 'text') process.stdout.write(event.content);
}
```

Use a server-side key (`infratex_sk_...`); keep it out of browser code.

## Parse methods

| Method | Credits / page | Notes |
|--------|----------------|-------|
| `standard` | 1 | Default. Fast, high-quality Markdown for most documents. |
| `max` | 3 | Figures are marked, captioned, and described. For documents where charts, diagrams, and photos carry meaning. |
| `infratex-phi` | 3 | Proprietary in-house model. Dense tables, financial statements, faithfulness-first OCR. |
| `infratex-gamma` | 1 | Layout-aware OCR. Faithful text and tables at volume, with a bounding box for every region. |
| `standard-ultra-2` | 3 | High-fidelity vision for complex nested tables and chart-heavy reports (API-only). |

Both `documents.upload(...)` and `documents.uploadImages(...)` accept any of these
methods and default to `standard`. A method that is temporarily unavailable is rejected
at upload with an `InfratexError` (status 503, code `method_unavailable`).

`infratex-gamma` also takes parse `options`, sent as one JSON object, for example
`options: { merge_tables: false, ignore_labels: ['header', 'footer'] }`. The keys and their
defaults are listed in the API docs (Parsing, "Parse options") and typed as `ParseOptions`;
other methods answer 422 `invalid_parse_configuration`.

`table_format` (`'otsl'` or `'html'`) sets the table syntax the parser emits; it is
honoured by `max`, `infratex-phi`, `infratex-gamma` and `standard-ultra-2` (`standard`
returns Markdown pipe tables). It is stored with the document: a document parsed as
`otsl` can be read back as either syntax with `documents.markdown(id, { table_format })`,
one parsed as `html` only as HTML.

`documents.upload(...)` also accepts a Word `.docx`. It is read from the file itself (no
model call) and billed at the `standard` price whatever `method` you send; the document
reports `standard` as its method. Legacy `.doc` and macro-enabled `.docm` files are
rejected with status 415.

## API reference

### `new Infratex(config)`

| Option    | Type     | Default                      | Description            |
|-----------|----------|------------------------------|------------------------|
| `apiKey`  | `string` | —                            | Your API key           |
| `baseUrl` | `string` | `https://api.infratex.io`    | API base URL override  |
| `timeout` | `number` | `300000`                     | Request / poll timeout in ms |

### Documents

```typescript
// Upload from a file path or Buffer — waits for parsing and returns markdown.
const doc = await client.documents.upload('/path/to/file.pdf');
const doc = await client.documents.upload(buffer, { filename: 'report.pdf', method: 'max' });

// Word documents use the same call.
const contract = await client.documents.upload('/path/to/contract.docx');

// Table syntax: 'otsl' (default) or 'html'. Stored with the document, not changeable later.
const gamma = await client.documents.upload('/path/to/file.pdf', {
  method: 'infratex-gamma',
  table_format: 'otsl',
});

// infratex-gamma parse options, and its per-region bounding boxes once parsed.
const scan = await client.documents.upload('/path/to/scan.pdf', {
  method: 'infratex-gamma',
  options: { unwarp: true },
});
const { pages } = await client.documents.layout(scan.id);
for (const page of pages) {
  for (const region of page.regions) console.log(page.page, region.label, region.bbox); // pixels of a width x height image
}

// Upload an ordered image batch as document pages (file order = page order).
const images = await client.documents.uploadImages(['/tmp/page-1.png', '/tmp/page-2.png'], {
  method: 'standard',
  collection_id: 'col-id',
});

// Queue-first if you want to manage the parse lifecycle yourself.
const queued = await client.documents.upload('/path/to/file.pdf', { wait: false });
const ready = await client.documents.waitUntilParsed(queued.id); // or: get(queued.id, { wait: true })

// List / get / markdown
const { documents, total } = await client.documents.list({ limit: 50, status: 'parsed' });
const one = await client.documents.get('doc-id');
const markdown = await client.documents.markdown('doc-id');
const htmlTables = await client.documents.markdown('doc-id', { table_format: 'html' }); // OTSL as <table>
const noDescriptions = await client.documents.markdown('doc-id', { figure_descriptions: false });

// Figures cropped from a parsed PDF (any method). The figure block in the markdown
// carries the same src (figures/p12-1.png); bbox is [x1, y1, x2, y2] in PDF points.
const { figures } = await client.documents.listFigures('doc-id');
for (const figure of figures) {
  console.log(figure.page, figure.type, figure.src, figure.bbox);
  const png = await client.documents.downloadFigure('doc-id', figure.name); // BinaryResponse
  await png.save(figure.name);
}

// Rename or move between collections
await client.documents.update('doc-id', { filename: 'q3-report.pdf' });
await client.documents.update('doc-id', { collection_id: 'col-id' });
await client.documents.update('doc-id', { remove_collection: true });

// Delete
await client.documents.delete('doc-id');

// Index — waits until the method-specific index reaches "indexed".
await client.documents.index('doc-id', { method: 'hybrid' });

// Queue-first indexing if you want to manage polling yourself.
await client.documents.index('doc-id', { method: 'hybrid', wait: false });
const indexes = await client.documents.listIndexes('doc-id');
const index = await client.documents.waitUntilIndexed('doc-id', { method: 'hybrid' });
```

### Search

Retrieve cited context without generating text. Send one scope: `document_ids` **or**
`collection_id`.

```typescript
const { results } = await client.searches.create({
  query: 'Find indemnity carve-outs',
  method: 'hybrid',   // or 'vector'
  limit: 5,
  document_ids: ['doc-id'],
});
for (const hit of results) console.log(hit.document_name, hit.score, hit.content.slice(0, 160));
```

### Responses (streaming)

Stream answers grounded in indexed documents. Events arrive in order: `sources`,
`thinking` (only when `reasoning: true`), `text` deltas, then `done`.

```typescript
const stream = await client.responses.create({
  message: 'What are the top risks?',
  method: 'hybrid',
  model: 'fast',   // 'fast' (default) or 'pro'
  collection_id: 'col-id',
  limit: 8,
});

for await (const event of stream) {
  switch (event.type) {
    case 'sources': console.log('Sources:', event.content); break;
    case 'text': process.stdout.write(event.content); break;
    case 'error': console.error(event.content); break;
    case 'done': break;
  }
}
```

```typescript
// Managed multi-turn thread with persisted scope
const conv = await client.conversations.create({ title: 'Quarterly Analysis', collection_id: 'col-id' });

const stream = await client.responses.create({
  conversation_id: conv.id,   // scope comes from the conversation; omit document_ids/collection_id
  message: 'How does that compare with the previous quarter?',
  method: 'hybrid',
  model: 'pro',
});
```

### Extractions

Extract structured fields from a parsed document. Provide inline field definitions, or
reference a `template_id` created in the dashboard — exactly one is required.

```typescript
const run = await client.extractions.create({
  document_id: 'doc-id',
  model: 'fast',              // 'fast' (default) or 'pro'
  include_evidence: true,
  inline_fields: [
    { name: 'counterparty', type: 'string', description: 'Legal name of the counterparty' },
    { name: 'effective_date', type: 'date', description: 'Contract effective date' },
    { name: 'termination_fee', type: 'number', description: 'Any explicit termination fee' },
  ],
});

const result = await client.extractions.waitUntilDone(run.id, { include_evidence: true });
console.log(result.result);    // { counterparty: '...', effective_date: '...', ... }
console.log(result.evidence);  // per-field evidence (present because include_evidence was set)

// Reference a dashboard-managed template instead of inline fields
const templated = await client.extractions.create({ document_id: 'doc-id', template_id: 'tpl-id' });

// Run every step on Infratex's self-hosted model
const phi = await client.extractions.create({ document_id: 'doc-id', template_id: 'tpl-id', model: 'infratex-phi' });

// Exhaustive mode for list fields where every item matters (footnotes, line items):
// reads every part of the document for array fields, then checks for missed items.
const exhaustive = await client.extractions.create({
  document_id: 'doc-id',
  template_id: 'tpl-id',
  completeness: 'exhaustive',
});

// v2 (beta): 'legacy' (default) or 'v2'. v2 opens per account; check before asking for it.
import { InvalidPipelineError, PipelineNotAvailableError } from 'infratex';

const { pipelines } = await client.extractions.listPipelines();
const v2Open = pipelines.some((p) => p.id === 'v2' && p.available);
try {
  const v2 = await client.extractions.create({ document_id: 'doc-id', template_id: 'tpl-id', pipeline: 'v2' });
  const done = await client.extractions.waitUntilDone(v2.id);
  console.log(done.pipeline, done.credits_charged, done.cached); // the engine that ran, its cost
} catch (err) {
  if (err instanceof PipelineNotAvailableError) console.log(err.availablePipelines); // ['legacy']
}

// Parse and extract in one call (POST /api/v1/extractions): a PDF, .docx or one image.
// wait (0-300 s) holds the request server-side until the run is done or failed.
let oneShot = await client.extractions.createFromFile('./contract.pdf', {
  method: 'standard',
  model: 'pro',
  inline_fields: [{ name: 'counterparty', type: 'string', description: 'Legal name' }],
  wait: 180,
});
if (oneShot.status !== 'done' && oneShot.status !== 'error') {
  oneShot = await client.extractions.waitUntilDone(oneShot.id);
}

// Poll with a server-side hold instead of client-side polling
const polled = await client.extractions.get(run.id, { wait: 60 });

// List prior runs, then export tabular results
const { runs } = await client.extractions.list('doc-id');
const file = await client.extractions.export(run.id, { format: 'xlsx' }); // or 'csv'
await file.save('results.xlsx');
```

Field definitions support nested shapes: `type` may be `string`, `number`, `integer`,
`boolean`, `date`, `enum`, `object`, or `array`. Use `enum_values` for `enum`,
`properties` (a list of fields) for `object`, and `items` (a single field) for `array`.
Extraction templates are created and managed in the dashboard. `completeness` is
`'standard'` (default) or `'exhaustive'`; exhaustive runs are slower and bill more tokens,
and the run reports the mode it used in `run.completeness`.

`pipeline` is sent in the request body only when you set it (never as a query parameter).
`'v2'` before the beta is open for your account throws `PipelineNotAvailableError`
(422 `pipeline_not_available`); any other value throws `InvalidPipelineError`
(422 `invalid_pipeline`). Nothing is created or billed when a run is refused. Every finished
run reports the engine that ran in `run.pipeline`, what it charged in `run.credits_charged`,
and whether an earlier identical result was reused at no charge in `run.cached`.

### Collections

```typescript
const col = await client.collections.create({ name: 'Q3 Reports' });
const cols = await client.collections.list();
const one = await client.collections.get('col-id');
await client.collections.update('col-id', { name: 'Q4 Reports' });
await client.collections.delete('col-id');
```

### Conversations

```typescript
const conv = await client.conversations.create({ title: 'Analysis', collection_id: 'col-id' });
const convs = await client.conversations.list();
const full = await client.conversations.get('conv-id');  // includes messages
await client.conversations.delete('conv-id');
```

### Account & Billing

```typescript
const { tenant } = await client.account.get();
console.log(tenant.email, tenant.credit_balance_micros);

const settings = await client.account.settings();
console.log(settings.allow_overage, settings.monthly_spend_cap_micros, settings.data_residency);

// Restrict processing to the EU. An API key can turn eu_only on; only the dashboard
// can switch it back to 'default' (403 dashboard_only).
await client.account.updateSettings({ data_residency: 'eu_only' });

const billing = await client.billing.get();
console.log(billing.balance_micros, billing.totals);

// The credit ledger, newest first: every charge, refund, grant and top-up with the
// balance after it. Amounts are in micro-euros (1 credit = 5,000).
const page = await client.billing.listTransactions({ since: '2026-10-01T00:00:00Z', limit: 100 }); // limit <= 500
for (const tx of page.transactions) {
  console.log(tx.created_at, tx.transaction_type, tx.amount_micros, tx.description);
}
if (page.next_before) {
  const older = await client.billing.listTransactions({ before: page.next_before });
}

// Or let the SDK follow next_before for you.
for await (const tx of client.billing.iterTransactions({ since: new Date('2026-10-01T00:00:00Z') })) {
  console.log(tx.source_id, tx.amount_micros);
}
```

`since` / `until` / `before` take a `Date` or an ISO 8601 string. A parse charge carries
the document id in `source_id` and the file name and billed pages in `description` and
`metadata`.

### Webhooks

Register an HTTPS endpoint and Infratex POSTs a signed JSON event when a parse, an index
build or an extraction run finishes or fails, instead of you polling.

```typescript
const hook = await client.webhooks.create({
  url: 'https://example.com/infratex',
  events: ['document.parsed', 'extraction.completed'], // empty or omitted: every type
  description: 'production',
});
const secret = hook.secret; // shown only here and on rotateSecret(): store it

await client.webhooks.list();
await client.webhooks.get(hook.id);
await client.webhooks.update(hook.id, { enabled: false }); // or url, events, description (null clears)
await client.webhooks.test(hook.id);                       // queues a webhook.test event
const { items } = await client.webhooks.listDeliveries(hook.id, { status: 'failed', limit: 20 });
for (const delivery of items) await client.webhooks.retryDelivery(hook.id, delivery.id);
const { secret: newSecret } = await client.webhooks.rotateSecret(hook.id);
await client.webhooks.delete(hook.id);
```

Verify each delivery over the raw request body before trusting it, and deduplicate on the
`Infratex-Event-Id` header (the same on every retry):

```typescript
import express from 'express';
import { verifyWebhookSignature } from 'infratex';

app.post('/infratex', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifyWebhookSignature(SECRET, req.body, req.get('Infratex-Signature') ?? '')) {
    return res.status(400).end();
  }
  const event = JSON.parse(req.body.toString('utf8'));
  // ...
  res.status(200).end();
});
```

## Error handling

All API errors throw an `InfratexError`:

```typescript
import { InfratexError } from 'infratex';

try {
  await client.documents.get('nonexistent');
} catch (err) {
  if (err instanceof InfratexError) {
    console.error(err.status);     // 404
    console.error(err.code);       // error code from the API, e.g. 'not_found'
    console.error(err.message);    // human-readable message
    console.error(err.details);    // extra fields the API sent, if any
    console.error(err.requestId);  // quote it when you contact support
    console.error(err.retryAfter); // Retry-After in seconds (429, 409 idempotency_request_in_progress)
  }
}
```

`InvalidPipelineError` and `PipelineNotAvailableError` extend `InfratexError` for the two
extraction `pipeline` refusals; every other API error code is in `err.code`.

### Retries and idempotency

A request that times out may still have been accepted. To retry a create safely, pass the
same `idempotency_key` on every attempt: within 24 hours the API returns the first response
instead of creating (and billing) the work twice. It is accepted on `documents.upload`,
`documents.uploadImages`, `documents.index`, `extractions.create` and
`extractions.createFromFile`.

```typescript
import { randomUUID } from 'node:crypto';

const key = randomUUID(); // one key per document, reused on every retry
let doc;
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    doc = await client.documents.upload('./contract.pdf', { idempotency_key: key, wait: false });
    break;
  } catch (err) {
    if (err instanceof InfratexError && ![409, 429, 500, 502, 503, 504].includes(err.status)) throw err;
    const seconds = err instanceof InfratexError ? (err.retryAfter ?? 2 ** attempt) : 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
```

## Development

```bash
npm ci
npm test            # node:test suite with mocked fetch, no API key needed
npm run typecheck   # strict tsc over src/ and test/
npm run build       # ESM + CJS output in dist/
```

## License

MIT
