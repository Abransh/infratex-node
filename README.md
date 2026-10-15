# Infratex Node.js SDK

Official Node.js / TypeScript SDK for the [Infratex](https://infratex.io) document intelligence API.

- Parse PDFs, Word documents, or ordered image batches into structured Markdown
- Build vector and hybrid search indexes
- Retrieve cited context and stream grounded AI answers
- Extract structured fields from documents

Requires **Node.js 18+**. Zero runtime dependencies — uses the native `fetch` API.

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

// List prior runs, then export tabular results
const { runs } = await client.extractions.list('doc-id');
const file = await client.extractions.export(run.id, { format: 'xlsx' }); // or 'csv'
await file.save('results.xlsx');
```

Field definitions support nested shapes: `type` may be `string`, `number`, `integer`,
`boolean`, `date`, `enum`, `object`, or `array`. Use `enum_values` for `enum`,
`properties` (a list of fields) for `object`, and `items` (a single field) for `array`.
Extraction templates are created and managed in the dashboard.

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
console.log(settings.allow_overage, settings.monthly_spend_cap_micros);

const billing = await client.billing.get();
console.log(billing.balance_micros, billing.totals);
```

## Error handling

All API errors throw an `InfratexError`:

```typescript
import { InfratexError } from 'infratex';

try {
  await client.documents.get('nonexistent');
} catch (err) {
  if (err instanceof InfratexError) {
    console.error(err.status);   // 404
    console.error(err.code);     // error code from the API
    console.error(err.message);  // human-readable message
  }
}
```

## License

MIT
