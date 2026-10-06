import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/ -> code-rag -> tools -> repo root
const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

// Index scope. Add entries (e.g. 'src/games') to widen it.
export const INDEX_ROOTS = ['src/core', 'docs'];

export const INCLUDE_SUFFIXES = new Set(['.js', '.mjs', '.cjs', '.ts', '.css', '.md', '.html']);

export const EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'art-source',
  'vibe_images',
  'test-results',
  '.venv',
  '__pycache__',
  '.cache',
]);

// Embeddings: EmbeddingGemma v1 (300M) served by Ollama. Chosen over
// EmbeddingGemma 2 / ONNX because only Ollama's GGML engine reaches the GPU on
// this machine (~10x faster indexing at equal top-5 recall). See README.
export const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
export const OLLAMA_MODEL = process.env.CODE_RAG_OLLAMA_MODEL || 'embeddinggemma';

// Asymmetric task prefix (model card): queries carry the task prefix, documents
// the title/text form.
export const QUERY_PREFIX = 'task: search result | query: ';
// Long sequences dominate embedding cost; cap the code part (0 = no cap).
export const MAX_DOC_CHARS = Number(process.env.CODE_RAG_MAX_DOC_CHARS ?? 1600);

export const QUERY_TEXT = (q) => QUERY_PREFIX + q;
export const DOC_TEXT = (title, code) =>
  `title: ${title} | text: ${MAX_DOC_CHARS ? code.slice(0, MAX_DOC_CHARS) : code}`;

// DB path resolves against the tool directory, never the process cwd, so the
// CLI, indexer and MCP server all hit the same database from any working dir.
export const DB_PATH = process.env.CODE_RAG_DB
  ? path.resolve(PKG_DIR, process.env.CODE_RAG_DB)
  : path.join(PKG_DIR, 'index.db');

// Chunk geometry. 40 lines keeps sequences short (the dominant cost) and is the
// configuration the retrieval eval was tuned on.
export const MAX_CHUNK_LINES = Number(process.env.CODE_RAG_MAX_CHUNK_LINES ?? 40);
export const MIN_CHUNK_LINES = 5;
export const WINDOW_OVERLAP = Number(process.env.CODE_RAG_WINDOW_OVERLAP ?? 12);
