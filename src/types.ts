// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface InfratexConfig {
  /** API key starting with `infratex_sk_...` */
  apiKey: string;
  /** Base URL override. Defaults to `https://api.infratex.io`. */
  baseUrl?: string;
  /** Default request timeout in milliseconds. Defaults to 300_000 (5 min). */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** The `error` object of an API error response. */
export interface InfratexErrorBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type ParseMethod =
  | 'standard'
  | 'max'
  | 'standard-ultra-2'
  | 'infratex-phi'
  | 'infratex-gamma';
/**
 * Table syntax the parser emits. Stored with the document and not changeable
 * later: a document parsed as `otsl` can be read back as either syntax, one
 * parsed as `html` only as HTML. `standard` always returns Markdown pipe tables.
 */
export type TableFormat = 'otsl' | 'html';
/**
 * Parse engine version: `2.0` (stable, the server default) or `2.5` (beta).
 * `standard-ultra-2` only.
 */
export type ParseEngineVersion = '2.0' | '2.5';
/**
 * Parse speed: `standard` (the server default) or `fast`. `fast` is
 * `standard-ultra-2` only and costs 4x the page price.
 */
export type ParseSpeed = 'standard' | 'fast';
export type DocStatus = 'pending' | 'processing' | 'done' | 'parsed' | 'indexed' | 'error';
export type IndexStatus = 'pending' | 'processing' | 'indexed' | 'error';

export interface DocumentRegion {
  id: number;
  label: string;
  bbox: number[];
  content: string;
  page: number;
}

export interface DocumentExtractionPage {
  page: number;
  width: number;
  height: number;
  markdown: string;
  regions: DocumentRegion[];
  images: Record<string, string>;
}

export interface UploadResponse {
  id: string;
  status: string;
  method: ParseMethod;
  filename: string;
  page_count: number | null;
  markdown: string | null;
  extraction_ms: number;
  collection_id: string | null;
  extraction_pages: DocumentExtractionPage[] | null;
  /** As {@link Document.engine_version}. */
  engine_version?: string | null;
  /** As {@link Document.speed}. */
  speed?: string | null;
}

/**
 * `queued`: waiting for a worker (also after a stopped run went back to the
 * queue); `parsing`: pages being read; `finishing`: every page through, the
 * result is being stored.
 */
export type DocumentProgressStage = 'queued' | 'parsing' | 'finishing';

/** Where a pending or processing document's parse is. */
export interface DocumentProgress {
  stage: DocumentProgressStage;
  /** Pages finished, including pages kept from a stopped run and pages that failed. */
  pages_done: number;
  pages_total: number | null;
  /** `0` while waiting for the first run; goes up when a stopped run went back to the queue. */
  attempt: number;
  /** Runs allowed; when this many have stopped, the document fails. */
  max_attempts: number;
  /**
   * `queued`: when the document entered the queue. `parsing` / `finishing`:
   * the worker's last report, at least every 30 s; several minutes old means
   * the run has stopped.
   */
  updated_at: string;
}

export interface Document {
  id: string;
  filename: string;
  upload_time: string;
  status: string;
  method: ParseMethod;
  pipeline: string | null;
  page_count: number | null;
  processing_time_ms: number | null;
  error_message: string | null;
  markdown_size_bytes: number | null;
  chunk_count: number | null;
  index_method: string | null;
  collection_id: string | null;
  extraction_pages: DocumentExtractionPage[] | null;
  indexes?: DocumentIndex[];
  /**
   * Set while the document is `pending` or `processing`; `null` once it is
   * parsed or failed (and for a moment while processing starts). Absent on
   * servers that predate it.
   */
  progress?: DocumentProgress | null;
  /**
   * The parse engine version the document was parsed with (`2.0`, `2.5`);
   * `null` for methods without engine versions. Absent on servers that
   * predate it.
   */
  engine_version?: string | null;
  /**
   * The parse speed (`standard` or `fast`); `null` for methods without a
   * speed choice. Absent on servers that predate it.
   */
  speed?: string | null;
}

export interface WaitUntilParsedOptions {
  /**
   * Called with the document's progress each time it differs from the last
   * one seen: a new stage, page count or attempt, or a fresh `updated_at`
   * from the worker's keepalive. Not called while the API reports no progress.
   */
  onProgress?: (progress: DocumentProgress) => void;
}

/** A figure cropped from a parsed PDF. */
export interface DocumentFigure {
  /** File name of the crop, e.g. `p12-1.png`. */
  name: string;
  /** The `src` the figure block in the Markdown carries, e.g. `figures/p12-1.png`. */
  src: string;
  page: number;
  index: number;
  /** Figure type, e.g. `chart`, `diagram`, `photo`, `table-image`, `logo`, `other`. */
  type: string;
  score: number;
  /** `[x1, y1, x2, y2]` in PDF points (1/72 inch), origin top-left of the page. */
  bbox: number[];
}

export interface DocumentFiguresResponse {
  document_id: string;
  figures: DocumentFigure[];
}

export interface DocumentLayoutPage {
  page: number;
  /** Width of the page image the region boxes are measured on, in pixels. */
  width: number;
  /** Height of the page image the region boxes are measured on, in pixels. */
  height: number;
  /** `bbox` is `[x1, y1, x2, y2]` in pixels; `content` is the region's text (tables as HTML). */
  regions: DocumentRegion[];
}

/** Per-page layout regions of a document parsed with `infratex-gamma`. */
export interface DocumentLayout {
  document_id: string;
  pages: DocumentLayoutPage[];
}

/**
 * `infratex-gamma` parse options, sent as one JSON object. Leave a key out to
 * keep its default. An unknown key or bad value is a 422
 * `invalid_parse_options`; any other parse method answers 422
 * `invalid_parse_configuration`.
 */
export interface ParseOptions {
  /** Detect and correct rotated pages. Default `true`. */
  detect_orientation?: boolean;
  /** Flatten curved, folded or photographed pages. Default `false`. */
  unwarp?: boolean;
  /** Read chart values into a table inside the chart figure. Default `true`. */
  chart_recognition?: boolean;
  /** Read the text inside images. Default `true`. */
  image_text?: boolean;
  /** Read stamps and seals. Default `true`. */
  seal_recognition?: boolean;
  /** Join a table that is split across pages. Default `true`. */
  merge_tables?: boolean;
  /** Rebuild heading levels consistently across the document. Default `true`. */
  relevel_titles?: boolean;
  /** Rejoin text that runs across pages. Default `true`. */
  restructure_pages?: boolean;
  /** Region kinds to leave out of the Markdown (e.g. `header`, `footer`, `page_number`). */
  ignore_labels?: string[];
  /** Split each page into regions first. Default `true`. */
  layout_detection?: boolean;
  /** With `layout_detection: false`: how to read each page. Default `ocr`. */
  task?: 'ocr' | 'table' | 'formula' | 'chart' | 'seal';
  /** Drop overlapping duplicate regions. Default `true`. */
  layout_nms?: boolean;
  /** Shape of detected regions. Default `auto`. */
  layout_shape_mode?: 'auto' | 'rect' | 'quad' | 'poly';
  /** 0 to 2. Default `0`. */
  temperature?: number;
  /** Above 0, up to 1. Default `1`. */
  top_p?: number;
  /** Above 0, up to 3. Default `1`. */
  repetition_penalty?: number;
  /** Smallest page-image budget, 3,136 to 16,777,216. Default `147384`. */
  min_pixels?: number;
  /** Largest page-image budget, 3,136 to 16,777,216. Default `2822400`. */
  max_pixels?: number;
  /** Options added to the API after this SDK release. */
  [option: string]: unknown;
}

/** One engine version of a parse method. */
export interface ParseEngineVersionInfo {
  version: string;
  status: 'stable' | 'beta';
  /** `true` for the version an upload without `engine_version` runs. */
  default: boolean;
}

/** A parse method's engine versions and speeds. */
export interface ParseEngine {
  method: string;
  versions: ParseEngineVersionInfo[];
  speeds: string[];
}

/** `GET /api/v1/parse-engines`: one entry per parse method. */
export type ParseEnginesResponse = ParseEngine[];

export interface DocumentListResponse {
  documents: Document[];
  total: number;
}

export interface UploadOptions {
  /**
   * Original filename. Recommended when uploading a Buffer: its extension
   * (`.pdf` or `.docx`) sets the file's content type.
   */
  filename?: string;
  /**
   * Parse method: `standard` (default), `max`, `infratex-phi`, `infratex-gamma`,
   * or `standard-ultra-2`.
   */
  method?: ParseMethod;
  /**
   * `standard-ultra-2` only: the parse engine version, `2.0` (stable, the
   * server default) or `2.5` (beta). Sent only when set. A version the API
   * does not know throws {@link InvalidEngineVersionError} (422
   * `invalid_engine_version`); any other method throws
   * {@link EngineVersionNotSupportedError} (422 `engine_version_not_supported`).
   * The document reports the version it was parsed with in `engine_version`.
   */
  engine_version?: ParseEngineVersion;
  /**
   * `standard-ultra-2` only: `standard` (the server default) or `fast`. Fast
   * pages cost 4x the page price. Sent only when set. Any other value throws
   * {@link InvalidSpeedError} (422 `invalid_speed`); `fast` with another
   * method throws {@link SpeedNotSupportedError} (422 `speed_not_supported`).
   * The document reports its speed in `speed`.
   */
  speed?: ParseSpeed;
  /** Table syntax: `otsl` (server default) or `html`. See {@link TableFormat}. */
  table_format?: TableFormat;
  /** `infratex-gamma` only: parse options. Sent only when set. */
  options?: ParseOptions;
  /** Assign to a collection on upload. */
  collection_id?: string;
  /**
   * Sent as the `Idempotency-Key` header. Reuse the same key when retrying the
   * same request: within 24 hours the API returns the first response instead
   * of creating (and billing) the work twice.
   */
  idempotency_key?: string;
  /** When false, return the queued document resource immediately. */
  wait?: boolean;
}

export interface ImageUploadOptions {
  /**
   * Parse method: `standard` (default), `max`, `infratex-phi`, `infratex-gamma`,
   * or `standard-ultra-2`.
   */
  method?: ParseMethod;
  /**
   * `standard-ultra-2` only: the parse engine version, `2.0` (stable, the
   * server default) or `2.5` (beta). Sent only when set. A version the API
   * does not know throws {@link InvalidEngineVersionError} (422
   * `invalid_engine_version`); any other method throws
   * {@link EngineVersionNotSupportedError} (422 `engine_version_not_supported`).
   * The document reports the version it was parsed with in `engine_version`.
   */
  engine_version?: ParseEngineVersion;
  /**
   * `standard-ultra-2` only: `standard` (the server default) or `fast`. Fast
   * pages cost 4x the page price. Sent only when set. Any other value throws
   * {@link InvalidSpeedError} (422 `invalid_speed`); `fast` with another
   * method throws {@link SpeedNotSupportedError} (422 `speed_not_supported`).
   * The document reports its speed in `speed`.
   */
  speed?: ParseSpeed;
  /** Table syntax: `otsl` (server default) or `html`. See {@link TableFormat}. */
  table_format?: TableFormat;
  /** `infratex-gamma` only: parse options. Sent only when set. */
  options?: ParseOptions;
  /** Assign to a collection on upload. */
  collection_id?: string;
  /**
   * Sent as the `Idempotency-Key` header. Reuse the same key when retrying the
   * same request: within 24 hours the API returns the first response instead
   * of creating (and billing) the work twice.
   */
  idempotency_key?: string;
  /** When false, return the queued document resource immediately. */
  wait?: boolean;
}

export interface MarkdownOptions {
  /**
   * `otsl` returns tables exactly as parsed; `html` converts every OTSL block to
   * a `<table>`. Omitted by default, so the server default (`otsl`) applies. A
   * document parsed with `table_format: 'html'` is always served as HTML.
   */
  table_format?: TableFormat;
  /**
   * Pass `false` to leave the generated `<description>` out of figure blocks
   * (the server default keeps them). Omitted unless set, so servers that
   * predate the parameter are unaffected.
   */
  figure_descriptions?: boolean;
}

export interface DocumentUpdateOptions {
  /** New filename. */
  filename?: string;
  /** Move the document into this collection. */
  collection_id?: string;
  /** Detach the document from its current collection. */
  remove_collection?: boolean;
}

export interface DocumentListOptions {
  status?: DocStatus;
  collection_id?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

export type IndexMethod = 'vector' | 'hybrid';

export interface DocumentIndex {
  id: string;
  document_id: string;
  filename?: string | null;
  method: IndexMethod;
  status: IndexStatus;
  node_count: number | null;
  chunk_count: number | null;
  has_ast: boolean;
  has_description: boolean;
  processing_time_ms: number | null;
  processing_ms: number;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndexCreateOptions {
  method: IndexMethod;
  wait?: boolean;
  /** Sent as the `Idempotency-Key` header; see {@link UploadOptions.idempotency_key}. */
  idempotency_key?: string;
}

export type IndexResponse = DocumentIndex & { filename: string };

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  document_id: string;
  document_name: string | null;
  score: number;
  content: string;
  title: string;
  summary: string;
  node_id: string | null;
  chunk_index: number | null;
  metadata: Record<string, unknown> | null;
  source: string;
}

export type ScopeSelector =
  | { document_ids?: string[]; collection_id?: never }
  | { document_ids?: never; collection_id?: string }
  | { document_ids?: never; collection_id?: never };

export type ConversationBoundScope = {
  conversation_id: string;
  document_ids?: never;
  collection_id?: never;
};

export type RequestScopedResponse =
  | ({ conversation_id?: undefined } & ScopeSelector)
  | ConversationBoundScope;

export type SearchCreateOptions = {
  method?: IndexMethod;
  query: string;
  limit?: number;
} & ScopeSelector;

export interface SearchResponse {
  method: IndexMethod;
  query: string;
  results: SearchResult[];
}

// ---------------------------------------------------------------------------
// Responses (AI generation, SSE)
// ---------------------------------------------------------------------------

export type ResponseCreateOptions = {
  method?: IndexMethod;
  model?: 'fast' | 'pro';
  reasoning?: boolean;
  message: string;
  limit?: number;
} & RequestScopedResponse;

export interface ResponseSourceCitation {
  id: number;
  document_id: string;
  document_name: string;
  snippet: string;
  node_id?: string;
  title?: string;
}

export interface ResponseTextEvent {
  type: 'text';
  content: string;
}

export interface ResponseSourcesEvent {
  type: 'sources';
  content: ResponseSourceCitation[];
}

export interface ResponseThinkingEvent {
  type: 'thinking';
  content: string;
}

export interface ResponseErrorEvent {
  type: 'error';
  content: string;
}

export interface ResponseDoneEvent {
  type: 'done';
}

export type ResponseEvent =
  | ResponseTextEvent
  | ResponseThinkingEvent
  | ResponseSourcesEvent
  | ResponseErrorEvent
  | ResponseDoneEvent;

// ---------------------------------------------------------------------------
// Extractions
// ---------------------------------------------------------------------------

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'object'
  | 'array';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  description: string;
  instructions?: string | null;
  required?: boolean;
  /** Required when `type` is `enum`; forbidden otherwise. */
  enum_values?: string[] | null;
  /** Required when `type` is `object`; a list of nested fields. */
  properties?: FieldDefinition[] | null;
  /** Required when `type` is `array`; the element field definition. */
  items?: FieldDefinition | null;
}

/** `infratex-phi` runs every step of the run on Infratex's self-hosted model. */
export type ExtractionModel = 'fast' | 'pro' | 'infratex-phi';
/** `legacy` is the current engine; `v2` is the beta, open per account. */
export type ExtractionPipeline = 'legacy' | 'v2';
export type ExtractionStatus = 'pending' | 'processing' | 'done' | 'error';
/** `C` is an auto-chunked extraction of a large document that has no index. */
export type ExtractionTier = 'S' | 'M' | 'L' | 'C';
export type ExportFormat = 'csv' | 'xlsx';
export type ExtractionCompleteness = 'standard' | 'exhaustive';

export interface ExtractionCreateOptions {
  /** The parsed document to extract from. */
  document_id: string;
  /** Inline field definitions. Mutually exclusive with `template_id`. */
  inline_fields?: FieldDefinition[];
  /** Reference a dashboard-managed template. Mutually exclusive with `inline_fields`. */
  template_id?: string;
  /** Optional system prompt. Only valid alongside `inline_fields`. */
  inline_system_prompt?: string;
  /** `fast` (default), `pro`, or `infratex-phi`. */
  model?: ExtractionModel;
  /** Compute and return evidence payloads on the run. */
  include_evidence?: boolean;
  /**
   * `standard` (server default) or `exhaustive`. Exhaustive reads every part of
   * the document for array fields, merges and de-duplicates the items, then
   * checks for missed ones. Slower, and bills more tokens; scalar fields are
   * unaffected. Sent only when set.
   */
  completeness?: ExtractionCompleteness;
  /**
   * `legacy` (the current engine, server default) or `v2` (beta). Sent only
   * when set. `v2` before the beta is open for the account throws
   * {@link PipelineNotAvailableError} (422 `pipeline_not_available`); any other
   * value throws {@link InvalidPipelineError} (422 `invalid_pipeline`). Nothing
   * is created or billed then. `extractions.listPipelines()` says what the
   * account can choose; `run.pipeline` reports the engine that ran.
   */
  pipeline?: ExtractionPipeline;
  /** Sent as the `Idempotency-Key` header; see {@link UploadOptions.idempotency_key}. */
  idempotency_key?: string;
}

/** The run of `extractions.createFromFile(...)`: the run body, the parse method and a server-side wait. */
export type ExtractionFromFileOptions = Omit<ExtractionCreateOptions, 'document_id'> & {
  /** Original filename. Recommended when uploading a Buffer: its extension sets the file's content type. */
  filename?: string;
  /**
   * Parse method. Server default `standard`; with `model: 'infratex-phi'` the
   * default is `infratex-phi` and only `infratex-phi` or `infratex-gamma` are accepted.
   */
  method?: ParseMethod;
  /**
   * Seconds (0 to 300) the server holds the request until the run is `done`
   * or `error`. The run is returned either way: check `run.status`, or call
   * `waitUntilDone`. Keep it below the client `timeout`.
   */
  wait?: number;
};

export interface ExtractionGetOptions {
  include_evidence?: boolean;
  /**
   * Seconds (0 to 300) the server holds the request until the run is `done`
   * or `error`; the run is returned either way. Keep it below the client `timeout`.
   */
  wait?: number;
}

export interface ExtractionListOptions {
  limit?: number;
  offset?: number;
  include_evidence?: boolean;
}

export interface ExtractionExportOptions {
  format?: ExportFormat;
}

export interface ExtractionRun {
  id: string;
  document_id: string;
  template_id: string | null;
  status: ExtractionStatus;
  tier: ExtractionTier | null;
  model: string;
  completeness: ExtractionCompleteness;
  result: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  processing_time_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Credits the run charged (1 credit = €0.005): `0` for a cached or failed run, `null` while it runs. */
  credits_charged: number | null;
  /** Extraction engine build that computed the result. */
  engine_version: string | null;
  /** The pipeline that ran; `null` until the run finishes. */
  pipeline: ExtractionPipeline | null;
  /** `true` when an identical earlier run's result was reused at no charge. */
  cached: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** One extraction pipeline; `available` says whether this account may choose it per run. */
export interface ExtractionPipelineInfo {
  id: ExtractionPipeline;
  label: string;
  stage: 'stable' | 'beta';
  available: boolean;
}

/** `GET /api/v1/extraction-pipelines`. `default` is what a run without `pipeline` executes. */
export interface ExtractionPipelinesResponse {
  default: ExtractionPipeline;
  pipelines: ExtractionPipelineInfo[];
}

export interface ExtractionRunListResponse {
  runs: ExtractionRun[];
  total: number;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface Collection {
  id: string;
  name: string;
  created_at: string;
}

export interface CollectionCreateOptions {
  name: string;
}

export interface CollectionUpdateOptions {
  name: string;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface Conversation {
  id: string;
  title: string;
  collection_id: string | null;
  document_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ConversationMessage[];
}

export type ConversationCreateOptions = {
  title?: string;
} & ScopeSelector;

export type Message = ConversationMessage;

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  email: string | null;
  credit_balance_micros: number;
  is_admin: boolean;
  is_frozen: boolean;
  frozen_reason: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface AccountResponse {
  tenant: Tenant;
}

/**
 * `default`: every parse method and model is available. `eu_only`: a request
 * that would be processed outside the EU is refused with 422.
 */
export type DataResidency = 'default' | 'eu_only';

export interface AccountSettings {
  allow_overage: boolean;
  monthly_spend_cap_micros: number | null;
  low_balance_threshold_micros: number;
  has_payment_method: boolean;
  data_residency: DataResidency;
}

/** The account settings an API key may change. */
export interface AccountSettingsUpdateOptions {
  data_residency: DataResidency;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

/**
 * One credit-ledger entry: a charge, refund, grant or top-up. Amounts are in
 * micro-euros (1 credit = 5,000). A parse charge carries the document id in
 * `source_id` and the file name and billed pages in `description` and `metadata`.
 */
export interface BillingTransaction {
  id: string;
  transaction_type: string;
  status: string;
  amount_micros: number;
  balance_after_micros: number;
  currency: string;
  source_type: string | null;
  source_id: string | null;
  description: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface BillingUsageEvent {
  id: string;
  service_key: string;
  status: string;
  unit_count: number;
  unit_label: string;
  unit_price_micros: number;
  total_cost_micros: number;
  document_id: string | null;
  request_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface BillingServiceSpend {
  service_key: string;
  total_cost_micros: number;
  total_units: number;
}

export interface BillingDailySpend {
  day: string;
  total_cost_micros: number;
  total_units: number;
  by_service: Record<string, number>;
}

export interface BillingSummaryResponse {
  balance_micros: number;
  recent_transactions: BillingTransaction[];
  recent_credit_transactions: BillingTransaction[];
  recent_usage: BillingUsageEvent[];
  spend_by_service: BillingServiceSpend[];
  daily_spend: BillingDailySpend[];
  totals: Record<string, number>;
}

export interface BillingTransactionListOptions {
  /** Only transactions at or after this time (a `Date` or an ISO 8601 string). */
  since?: Date | string;
  /** Only transactions before this time. */
  until?: Date | string;
  /** Cursor: the `next_before` of the previous page. */
  before?: Date | string;
  /** Page size, 1 to 500. The server default is 100. */
  limit?: number;
}

export interface BillingTransactionIterateOptions {
  /** Only transactions at or after this time (a `Date` or an ISO 8601 string). */
  since?: Date | string;
  /** Only transactions before this time. */
  until?: Date | string;
  /** Transactions fetched per request, 1 to 500. Defaults to 500. */
  page_size?: number;
}

/** A page of the credit ledger, newest first. */
export interface BillingTransactionPage {
  transactions: BillingTransaction[];
  /** Pass as `before` to fetch the next (older) page; `null` on the last page. */
  next_before: string | null;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookEvent =
  | 'document.parsed'
  | 'document.failed'
  | 'index.completed'
  | 'index.failed'
  | 'extraction.completed'
  | 'extraction.failed';

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

/** A registered webhook endpoint. `events` is empty when it takes every event type. */
export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Returned by `webhooks.create(...)` only: carries the signing secret. */
export interface WebhookCreated extends Webhook {
  secret: string;
}

export interface WebhookSecretResponse {
  secret: string;
}

export interface WebhookCreateOptions {
  /** Public HTTPS URL that receives the events. */
  url: string;
  /** Event types to send; empty or omitted sends every type. */
  events?: WebhookEvent[];
  description?: string;
}

export interface WebhookUpdateOptions {
  url?: string;
  /** `[]` makes the endpoint take every event type. */
  events?: WebhookEvent[];
  /** `null` removes the description. */
  description?: string | null;
  /** `false` pauses deliveries. */
  enabled?: boolean;
}

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  last_attempt_at: string | null;
  delivered_at: string | null;
  next_attempt_at: string | null;
}

export interface WebhookDeliveryListOptions {
  status?: WebhookDeliveryStatus;
  /** 1 to 100. The server default is 50. */
  limit?: number;
}

export interface WebhookDeliveryListResponse {
  items: WebhookDelivery[];
}
