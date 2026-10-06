# Code RAG (local semantic code search)

Local semantic search over `src/core/` + `docs/`, exposed to OpenCode through a
small MCP server so an agent can locate code by meaning before reading files.
Runs entirely in Node with no npm dependencies; embeddings come from Ollama.

## Stack

- **Embeddings:** EmbeddingGemma **v1** (300M) via Ollama (GGML/GPU). No npm deps.
- **Store:** Node's built-in `node:sqlite`; float32 blobs; brute-force cosine.
  Pilot-sized only — swap for `sqlite-vec` if the index grows large.
- **Chunking:** top-level declarations (JS/TS), headings (md), overlapping
  windows (other). Metadata = relpath + symbol + line range.

### Why v1 via Ollama, not EmbeddingGemma 2

EmbeddingGemma 2 runs only through ONNX/Transformers.js, and on this machine
DirectML did **not** accelerate it — so it indexed on CPU at ~0.7 chunks/s
(~20 min for this scope). Ollama's GGML engine reaches the GPU (~2 min for the
same scope) and, once docs are excluded from ranking, v1 matches v2's top-1 at
equal top-5 recall. v2 therefore bought nothing for ~10× the cost, so the ONNX
path was removed.

## Chosen configuration (measured)

40-line chunks, code-first search, on the 16-question set (`eval.mjs` /
`eval-code.mjs`):

| Config                | Index   | recall@1 | recall@5 | MRR   |
| --------------------- | ------- | -------- | -------- | ----- |
| **v1 + 40, code-only** | ~112 s | 75%      | 94%      | 0.828 |
| v2 + 90, code-only    | ~20 min | 75%      | 94%      | 0.799 |
| v1 + 40, with docs    | ~112 s  | 56%      | 94%      | 0.721 |

Docs are still indexed; `search_code` just defaults to code scope because design
docs otherwise outrank code semantically.

## Setup

Install [Ollama](https://ollama.com), then:

```bash
ollama pull embeddinggemma
```

No `npm install` needed. The Ollama server (desktop app or `ollama serve`) must
be running for indexing and search.

## Usage (CLI)

```bash
cd tools/code-rag
node src/cli.js index            # build/refresh (incremental by file hash)
node src/cli.js index --full     # force rebuild
node src/cli.js search "round timer reset" -k 5
node src/cli.js search "network envelope" --path src/core
node src/cli.js status
node eval.mjs                    # retrieval quality, all scopes
node eval-code.mjs               # retrieval quality, code-only
```

## Usage (MCP / OpenCode)

`node src/mcp.js` speaks MCP over stdio and exposes three tools:

- `search_code(query, k?, scope?, path?)` — ranked chunks with file path + line
  range. `scope` defaults to `code` (`src/`); use `docs` or `all` when needed.
  `path` overrides `scope`.
- `index_status()` — file/chunk counts, backend, freshness
- `reindex(full?)` — incremental refresh

Wired into this project by `opencode.json` at the repo root:

```jsonc
{
  "mcp": {
    "servers": {
      "code-rag": {
        "type": "local",
        "command": ["node", "tools/code-rag/src/mcp.js"]
      }
    }
  }
}
```

The MCP protocol for three read-only tools is small enough that a framework
(FastMCP) would only add a dependency, hence the dependency-free server. Paths
resolve against the tool directory (`src/config.js`), so the working directory
does not matter.

## Design

- **Vectors:** 768-dim, L2-normalized.
- **Task prefix:** asymmetric per model card — queries get
  `task: search result | query: {q}`, documents `title: {file} | text: {code}`.
- **Long sequences dominate cost**, hence 40-line chunks and a doc-size cap
  (`MAX_DOC_CHARS`).

Scope, model and geometry live in `src/config.js`. The index (`index.db*`) is
gitignored.
