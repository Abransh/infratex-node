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

export interface InfratexErrorBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
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
  /** Table syntax: `otsl` (server default) or `html`. See {@link TableFormat}. */
  table_format?: TableFormat;
  /** Assign to a collection on upload. */
  collection_id?: string;
  /** When false, return the queued document resource immediately. */
  wait?: boolean;
}

export interface ImageUploadOptions {
  /**
   * Parse method: `standard` (default), `max`, `infratex-phi`, `infratex-gamma`,
   * or `standard-ultra-2`.
   */
  method?: ParseMethod;
  /** Table syntax: `otsl` (server default) or `html`. See {@link TableFormat}. */
  table_format?: TableFormat;
  /** Assign to a collection on upload. */
  collection_id?: string;
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

export type ExtractionModel = 'fast' | 'pro';
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
  /** `fast` (default) or `pro`. */
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
}

export interface ExtractionGetOptions {
  include_evidence?: boolean;
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
  error_message: string | null;
  created_at: string;
  updated_at: string;
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

export interface AccountSettings {
  allow_overage: boolean;
  monthly_spend_cap_micros: number | null;
  low_balance_threshold_micros: number;
  has_payment_method: boolean;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

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
