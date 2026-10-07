# Code RAG (local semantic code search)

Local semantic search over a repository, exposed to OpenCode through a small
MCP server so an agent can locate code by meaning before reading files. Runs
entirely in Node with no npm dependencies; embeddings come from Ollama.

The same tool install serves **every project**: it derives the repo root from
the working directory, keeps one self-ignored index per repo, and is registered
globally so no per-project wiring is needed.

## Stack

- **Embeddings:** EmbeddingGemma **v1** (300M) via Ollama (GGML/GPU). No npm deps.
- **Store:** Node's built-in `node:sqlite`; float32 blobs; brute-force cosine.
  Pilot-sized only — swap for `sqlite-vec` if an index grows large.
- **Chunking:** top-level declarations (JS/TS), headings (md), overlapping
  windows (other). Metadata = relpath + symbol + line range.

### Why v1 via Ollama, not EmbeddingGemma 2

EmbeddingGemma 2 runs only through ONNX/Transformers.js, and on this machine
DirectML did **not** accelerate it — so it indexed on CPU at ~0.7 chunks/s
(~20 min). Ollama's GGML engine reaches the GPU (~5 min for a whole `src/`) and,
once docs are excluded from ranking, v1 matches v2's top-1 at equal top-5
recall. v2 bought nothing for ~10× the cost, so the ONNX path was removed.

## Chosen configuration (measured)

40-line chunks, code-first search, on the 16-question set (`eval.mjs` /
`eval-code.mjs`):

| Config                 | Index   | recall@1 | recall@5 | MRR   |
| ---------------------- | ------- | -------- | -------- | ----- |
| **v1 + 40, code-only** | ~112 s  | 75%      | 94%      | 0.828 |
| v2 + 90, code-only     | ~20 min | 75%      | 94%      | 0.799 |
| v1 + 40, with docs     | ~112 s  | 56%      | 94%      | 0.721 |

Docs are still indexed; `search_code` just defaults to code scope because design
docs otherwise outrank code semantically.

## Setup

Install [Ollama](https://ollama.com), then:

```bash
ollama pull embeddinggemma
```

No `npm install` needed. The Ollama server (desktop app or `ollama serve`) must
be running for indexing and search. Requires Node 22+ (`node:sqlite`).

### Global install (all projects)

The tool lives in this repo and is registered once in the global OpenCode
config, `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "servers": {
      "code-rag": {
        "type": "local",
        "command": ["node", "C:/Users/kemal/Desktop/brutal-party/tools/code-rag/src/mcp.js"]
      }
    }
  }
}
```

OpenCode launches a local MCP server with the workspace as its `cwd`, so the
server indexes whichever project the session is in. The first search in a new
project needs one `reindex` (full build); after that it is incremental.

## Usage (CLI)

Run from the repo root (the repo root is the working directory):

```bash
node tools/code-rag/src/cli.js index         # build/refresh (incremental)
node tools/code-rag/src/cli.js index --full  # force rebuild
node tools/code-rag/src/cli.js search "round timer reset" -k 5
node tools/code-rag/src/cli.js search "network envelope" --path src/core
node tools/code-rag/src/cli.js status
```

### Environment

| Variable                | Default              | Meaning                                        |
| ----------------------- | -------------------- | ---------------------------------------------- |
| `CODE_RAG_REPO`         | `cwd`                | Repo root to index/query (CLI outside the repo) |
| `CODE_RAG_ROOTS`        | `src,docs` if present, else `.` | Comma-separated index scope          |
| `CODE_RAG_DB`           | `<repo>/.code-rag/index.db` | Index path (relative to repo root)      |
| `CODE_RAG_OLLAMA_MODEL` | `embeddinggemma`     | Ollama model name                              |
| `OLLAMA_URL`            | `http://127.0.0.1:11434` | Ollama endpoint                            |

## Usage (MCP / OpenCode)

`node src/mcp.js` speaks MCP over stdio and exposes three tools:

- `search_code(query, k?, scope?, path?)` — ranked chunks with file path + line
  range. `scope` defaults to `code` (`src/`); use `docs` or `all` when needed.
  `path` overrides `scope`.
- `index_status()` — file/chunk counts, backend, freshness
- `reindex(full?)` — incremental refresh

The MCP protocol for three read-only tools is small enough that a framework
(FastMCP) would only add a dependency, hence the dependency-free server.

## Design

- **Vectors:** 768-dim, L2-normalized.
- **Task prefix:** asymmetric per model card — queries get
  `task: search result | query: {q}`, documents `title: {file} | text: {code}`.
- **Long sequences dominate cost**, hence 40-line chunks and a doc-size cap
  (`MAX_DOC_CHARS`).
- **One index per repo** at `<repo>/.code-rag/index.db`, kept out of git by a
  `*` `.gitignore` written inside the directory.

Scope, model and geometry live in `src/config.js`.
