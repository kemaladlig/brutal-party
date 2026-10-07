import fs from 'node:fs';
import path from 'node:path';

// Repo root. OpenCode launches a local MCP server with the workspace as its
// cwd, so inside the server `process.cwd()` is the project being worked on;
// the CLI uses wherever it is invoked. CODE_RAG_REPO overrides both.
export const REPO_ROOT = process.env.CODE_RAG_REPO
  ? path.resolve(process.env.CODE_RAG_REPO)
  : process.cwd();

// Index scope. CODE_RAG_ROOTS="src,docs" wins; otherwise prefer a conventional
// src/ layout (adding docs/ when present) and fall back to the whole repo.
function resolveRoots() {
  const fromEnv = process.env.CODE_RAG_ROOTS;
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const roots = ['src', 'docs'].filter((r) => fs.existsSync(path.join(REPO_ROOT, r)));
  return roots.length ? roots : ['.'];
}
export const INDEX_ROOTS = resolveRoots();

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
  '.code-rag',
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

// One index per repo, kept beside the project and self-ignored (see store.js),
// so a single tool install serves every project. CODE_RAG_DB overrides the
// path, resolved relative to the repo root.
export const DB_PATH = process.env.CODE_RAG_DB
  ? path.resolve(REPO_ROOT, process.env.CODE_RAG_DB)
  : path.join(REPO_ROOT, '.code-rag', 'index.db');

// Chunk geometry. 40 lines keeps sequences short (the dominant cost) and is the
// configuration the retrieval eval was tuned on.
export const MAX_CHUNK_LINES = Number(process.env.CODE_RAG_MAX_CHUNK_LINES ?? 40);
export const MIN_CHUNK_LINES = 5;
export const WINDOW_OVERLAP = Number(process.env.CODE_RAG_WINDOW_OVERLAP ?? 12);

// A directory is worth auto-indexing when it has a repo marker or a conventional
// source/docs root. Guards the background build from crawling a non-project cwd
// (e.g. the home directory) if a tool launches the server in the wrong place.
export function looksLikeProject(root = REPO_ROOT) {
  return ['.git', 'src', 'docs'].some((name) => fs.existsSync(path.join(root, name)));
}
