# Security & network contract

This Action receives your Notion integration token and runs inside your
repository. This document states precisely where your data can and cannot go.
Every claim here is enforced or reviewable in source
([audit & enforcement](#audit--enforcement) below lists how to re-check each
one); the maintainers' checklist at the bottom is what keeps it true when
dependencies change.

**The contract in one sentence:** the sync engine reads from the Notion API
(read-only) and downloads the files you uploaded to Notion from Notion's own
file hosts, and writes only the Jekyll files listed below into your own
checkout; it has no telemetry and never contacts InkDrafts.

## Outbound network destinations

The complete list. Anything not here is a contract violation and a bug.

| Destination | Who contacts it | When | What is sent |
|---|---|---|---|
| `https://api.notion.com/v1/` | The sync engine (the bundled `@notionhq/client`) | Every run | `NOTION_TOKEN` (as the `Authorization: Bearer` header), the database/page IDs from your inputs, and the `Notion-Version` header. Two read-only calls per synced row set: `POST /v1/databases/{id}/query` (filtered to `Status = Published`) and `GET /v1/blocks/{id}/children` (page bodies). Nothing is ever written to Notion. |
| Notion's file hosts: `prod-files-secure.s3.us-west-2.amazonaws.com`, `s3.us-west-2.amazonaws.com`, `file.notion.so` | The sync engine (one `fetch` call, `downloadFile()` in [`scripts/sync-notion.js`](scripts/sync-notion.js)) | When a published row holds a file uploaded to Notion (a photo, video, PDF, cover image or profile photo) that the site has no copy of yet | A plain `GET` of the signed URL Notion returned for that file. No token, no cookies, no headers of yours: the signature in the URL is the only credential, and Notion issued it for this one read. |
| `bun.sh` (release archive) and GitHub (`oven-sh/bun` tags/releases) | The `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (v2.2.0) setup step | Once per run, before the sync | Nothing of yours — it downloads the Bun runtime itself and resolves which version to fetch. Your token, database IDs, and content are not involved. |
| Your repository's own git remote | Your workflow's `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) and commit/push steps | Before and after the sync | Your synced content — this is the standard GitHub Actions flow in **your** repository, not this Action's code. |

That is all. Specifically:

- **No telemetry, no analytics, no error reporting.** The engine never
  contacts `inkdrafts.*` or any InkDrafts-owned endpoint. InkDrafts receives
  nothing from a sync run.
- **Notion-hosted files.** Notion links uploaded files through signed URLs
  that expire after an hour, so the engine copies each one into
  `assets/notion/` and links the copy. The download is refused unless:
  - the URL is `https` on one of the three Notion file hosts above, both
    before and after any redirect;
  - the file name ends in an extension on the engine's list (common photo,
    video, audio and document types; no HTML, SVG or scripts);
  - the response's `Content-Type` matches that kind of file (or is a generic
    binary type);
  - the file is at most 20 MB.
  A refused file is left out of the page and named in the run summary
  (`skipped`). Each copy is named after the URL without its signature, so a
  file is downloaded once and never re-fetched while it stays in the page.
- **External links are never fetched by the Action.** Images, videos,
  bookmarks, embeds and cover URLs you paste as links are copied verbatim
  into the generated Markdown. They are only fetched later — by Jekyll at
  site build or by a reader's browser — which happens outside this Action.
- **No package installation at run time.** The engine ships as a committed
  bundle (`dist/index.js`), so a consumer run never runs `bun install` and
  never contacts an npm registry. (The bundle references `node-fetch` because
  `@notionhq/client` uses it; Bun satisfies that with its built-in
  implementation over the native `fetch` — the package is not bundled and not
  downloaded.)
- `NOTION_BASE_URL` can redirect the engine's API endpoint (and lets file
  downloads come from that same origin), but it exists for the local test
  harness (which serves a fake Notion API on `localhost`) and is never set by
  `action.yml`. If you find it set in a workflow, that workflow is
  exfiltrating your token.

## What runs, and as whom

`action.yml` is a composite action with two steps: `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`
(v2.2.0) installs the runtime, then a single `bun dist/index.js` step runs the engine.
Both run on GitHub-hosted runners inside your job, with only the
permissions your workflow grants (`contents: write` if your commit step
pushes; the Action itself needs nothing beyond what the checkout gave it).
There are no Docker containers, no JavaScript-action `node20` shims, no
additional repositories checked out.

## Inputs and where they go

| Input / env var | Source | Goes to |
|---|---|---|
| `notion_token` → `NOTION_TOKEN` | Your secret | The Notion API `Authorization` header. Nothing else — never logged, never in outputs or the run summary (see [Redaction](#logging-and-redaction)), never written to disk. |
| `pages_database_id` → `NOTION_PAGES_DATABASE_ID` | Secret or variable | The Notion API query URL. Also redacted from the run summary. Note: this value **does appear in plain step logs** (`Database: …` lines) — see below. |
| `posts_database_id` → `NOTION_POSTS_DATABASE_ID` | Secret or variable | Same as above (legacy fallback: `NOTION_DATABASE_ID`). |
| `allow_bulk_delete` → `ALLOW_BULK_DELETE` | Input | Local behavior only — unlocks the bulk-delete guard. Never leaves the runner. |
| `MAX_DELETE_RATIO` (env only) | Your workflow | Local behavior only — the guard's ratio threshold. |
| `SITE_ROOT` (env only) | Set by `action.yml` to `$GITHUB_WORKSPACE` | Confines all writes to your checkout. |
| `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` | Set by the runner | The engine appends its two outputs and its Markdown summary to these runner-managed files. Contents are non-secret by construction. |
| `NOTION_BASE_URL` (env only) | Nothing sets it in this repo | Test hook; see above. |

A run with unusable credentials (`NOTION_TOKEN` missing/blank, or no database
ID) is a clean no-op: it exits 0, contacts nothing, and touches no files.

## Files written

All writes land inside `SITE_ROOT` (your checkout):

| Path | Contents |
|---|---|
| `_pages/{slug}.md` | One per published non-home page row |
| `_posts/{date}-{slug}.md` | One per published post row |
| `_data/nav.yml` | Nav labels/URLs of rows with *Show in Nav* |
| `_data/home.yml` | The home row's name, tagline, profile picture URL, social links, bio |
| `_config.yml` | Only the `title:`, `description:` and `author.name:` lines are rewritten, line by line |
| `assets/notion/{hash}-{name}.{ext}` | Copies of files uploaded to Notion that a generated page links to. Copies no generated page links to any more are deleted. |
| `$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY` | Runner-managed; appended `changed`/`summary` outputs and the Markdown run summary |

Deletions are limited to generated files whose `notion_id` front-matter keys
no longer appear among published rows, and to `assets/notion/` copies no
generated file links to. The bulk-delete guard holds the deletions back
when a run returns zero published rows, or would delete more than two files
and more than `MAX_DELETE_RATIO` (default 0.5) of a directory's tracked
files, unless `ALLOW_BULK_DELETE=true`. Removing only the template's example
post is always allowed. Nothing outside these paths is created, modified,
or removed.

## Logging and redaction

- **Never logged, anywhere:** the Notion token. The engine holds it in memory
  and sends it only to the Notion API. The Action's `GITHUB_OUTPUT`/run
  summary payloads are non-secret by construction
  ([schema](docs/run-summary-schema.md)), and GitHub additionally masks every
  value referenced via `${{ secrets.* }}` in step logs.
- **Redacted in the run summary:** the database IDs. Free-form error text is
  passed through a redaction step (`redact()` in
  [`scripts/sync-notion.js`](scripts/sync-notion.js)) that replaces the token
  and both database IDs with `[redacted]` before the summary is written; a
  test ([`test/run-summary-schema.test.js`](test/run-summary-schema.test.js))
  covers this. The `detail` line holds counts and outcome codes only — never
  page titles, filenames, or IDs.
- **Titles in the run summary.** The optional `affected` and `skipped`
  lists name rows by title so the site owner can find them: rows that could
  not be published, rows whose removal is waiting for confirmation, and rows
  published with something left out. They are titles of rows that are, or
  were, Published — public on the site already. Draft rows are never read.
- **Present in plain step logs:** page/post titles and slugs (per-row
  progress lines), filenames, and the database IDs (`Database: …` lines).
  For a public repository, Actions logs are readable by anyone. This is the
  current behavior, stated plainly: treat titles, slugs, and database IDs as
  public-if-your-repo-is-public. A database ID alone grants nothing — Notion
  API access requires the integration token, and the integration must have
  the database shared with it.

## Retention

- Synced content and its history live in **your** repository's git history,
  pushed to **your** remote. InkDrafts keeps no copy.
- Step logs and run summaries are retained by GitHub per your repository's
  Actions retention settings (GitHub's own policy — out of scope here). They
  are not sent anywhere else.

## Audit & enforcement

The contract is enforced by [`test/network-contract.test.js`](test/network-contract.test.js),
which fails CI when any of the following drifts. Results of the most recent
audit (issue #9, updated for the file downloads in 2.1.0):

- `dist/index.js` contains exactly four URL-literal hosts:
  `api.notion.com` (the endpoint) and
  `developers.notion.com` / `github.com` (two inert `@notionhq/client`
  package-metadata strings embedded by the bundler — never dereferenced).
  No other host appears anywhere in the bundle.
- `@notionhq/client` is the only runtime dependency, and the only third-party
  code in the bundle (verified via the bundle's embedded
  `// node_modules/...` provenance comments). Its only network primitive is
  the client's request to its configured prefix URL (`https://api.notion.com/v1/`).
- The engine source imports `fs` and `path` (plus the client) and nothing
  network-facing. It makes exactly one `fetch` call of its own, in
  `downloadFile()`, which sends no headers and runs only after the host
  check against the three Notion file hosts.
- `action.yml` references exactly one third-party action:
  `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (v2.2.0, pinned
  to the full commit SHA).
- No InkDrafts, telemetry, or analytics reference exists in the engine or the
  bundle, apart from the web address of the InkDrafts template's example post
  (`welcome-to-inkdrafts`), which the bulk-delete guard compares against
  local files so the owner can remove that post.

Re-check the endpoint claim by hand at any time:

```bash
grep -oE 'https?://[a-zA-Z0-9._-]+' dist/index.js | sort -u
grep -oE '// node_modules/[^ "]+' dist/index.js | sort -u
```

## Maintainers' checklist for dependency changes

Any change that could touch the network — a new npm dependency, a new
`uses:` step, a new environment variable that points somewhere — must update
this document and the enforcement test in the same PR. Before merging:

1. **Runtime dependency added or bumped?** Rebuild `dist/` and confirm the
   bundle still embeds only expected packages
   (`grep -oE '// node_modules/[^ "]+' dist/index.js | sort -u`), that every
   URL literal in the bundle is accounted for in this document, and that the
   new code contacts nothing beyond the allowlist. Update
   `test/network-contract.test.js` allowlists — the test must *fail first*,
   then pass because you consciously updated it.
2. **New `uses:` step in `action.yml` or the workflows?** Pin it to a full
   commit SHA with the version in a trailing comment
   (`owner/action@<40-hex-sha> # vX.Y.Z`), check what it downloads and what it
   uploads, and add it to this document's destinations table.
3. **New environment variable or input?** Add it to the inputs table with
   where it goes. Anything that can redirect a network destination (as
   `NOTION_BASE_URL` can) must be documented as a test hook and never set by
   the Action itself.
4. **New file writes?** They belong in the files table and nowhere else.
5. **Re-run the audit greps above and `bun test`** — both must pass before
   merge.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). Please do not open a public issue
for anything that could expose tokens or content.
