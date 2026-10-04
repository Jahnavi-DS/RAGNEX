# RAGNEX

From Retrieval to Autonomous Investigation — compare traditional RAG, GraphRAG, and Agentic GraphRAG workflows side by side.

## Development

You need Node.js (or Bun) installed.

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Scripts

- `npm run dev` — start the local dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — run lint checks
- `npm run format` — format the codebase

## Hidden evaluation benchmark

The 50 evaluation questions are stored in `data/questions/eval_hidden.jsonl`.
Real generated results are not committed. To run all 50 questions sequentially
against the configured Groq and TigerGraph integrations and write
`benchmark-results/hidden-questions-results.json`, explicitly run:

```sh
npm run benchmark:hidden -- --run
```

This makes real backend requests and may take time or consume API quota. For a
small opt-in run, pass `--limit 1` (or another positive count up to 50). The
runner does not load `.env` itself; configure credentials through the normal
environment before starting it. Existing result files are not overwritten
unless `--overwrite` is also passed. Each output record includes the dataset
question ID and type, actual answers (or `null` when an approach returns an
error), token counts and latency as reported by the approach, approach
statuses, and the Agentic GraphRAG trace. Unavailable measurements remain
`null`.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
