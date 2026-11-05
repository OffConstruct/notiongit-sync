# Changelog

All notable changes to `notiongit-sync` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); version numbers
follow the compatibility promise in [RELEASING.md](RELEASING.md).

Every `vX.Y.Z` tag below is immutable once published — its section here is
never edited after release. Add new entries under **Unreleased** as you make
changes, then turn `Unreleased` into a dated `## [X.Y.Z] - YYYY-MM-DD` section
when [cutting that release](RELEASING.md#cutting-a-release); the release
workflow refuses to tag a version with no matching section here.

## [Unreleased]

Planned as 2.1.0. Additive within run summary `schema_version` 1; generated
files change once on upgrade (slugs are now quoted in front matter).

### Added

- Files uploaded to Notion (photos, videos, PDFs, audio and documents in the
  page body, the post `Cover Image`, the home `Profile Picture`) are copied
  into `assets/notion/` and linked from there, instead of linking Notion's
  signed URLs, which expire after an hour and changed on every run. Copies
  are named after the URL without its signature, so each file is fetched
  once; unlinked copies are deleted. Downloads are limited to Notion's file
  hosts, known file types and 20 MB (see SECURITY.md). `Profile Picture`
  accepts Files & media as well as text.
- Nested blocks are read three levels deep: toggles publish their contents,
  nested lists nest, columns are flattened, tables render as GFM tables,
  synced blocks render their content, embeds render as links, and file / PDF
  / audio blocks as download links.
- Column aliases for the v2 InkDrafts template: `Web address` (Slug),
  `Menu order` (Nav Order), `Show in menu` (Show in Nav), `Cover image` /
  `Cover` (Cover Image), `Originally published at` (Canonical URL), and the
  `Type` labels `Home page`, `List of posts` and `Regular page`. The title is
  found by its Notion type, whatever the column is called.
- The home row's `Tagline` (or `Summary`) is written to `_config.yml` as
  `description`.
- Posts dated in the future are held back until their date
  (`posts.scheduled` in the run summary) and are never deleted meanwhile.
- Run summary: optional `affected` (rows not published, or whose removal is
  held back, by title and `reason_code`), optional `skipped` (rows published
  with a file or block left out), and optional `scheduled` /
  `skipped_blocks` section counts.
- Text that looks like Liquid is wrapped in `{% raw %}`, so it can't break
  the Jekyll build.

### Changed

- The bulk-delete guard works per section and holds deletions back instead
  of aborting the run: the other section, and the held-back section's other
  changes, still go through (`changed` reports them; the engine still exits
  1). Removing only the template's example post, or up to two rows while
  Notion still returns published rows, is always allowed.
- A run where some rows fail (`row_errors`) now exits 0 with a
  `::warning::`, so the rest of the site keeps updating.
- Web addresses: a typed slug that would break a URL or filename is cleaned
  up (`Mi viaje: día 1` → `mi-viaje-dia-1`), accents are transliterated
  instead of dropped, a row keeps its existing address when only its title
  changes, a title with no Latin letters falls back to `page-` plus the row
  id, and slugs are written quoted. Two rows with the same address no longer
  overwrite each other: the second is reported (`duplicate_web_address`).
- A post with no date uses the day it was created, not the day of the run.
  A date with a time no longer leaks the time into the filename.
- Titles and text properties read every rich-text part, so formatting in a
  title no longer cuts it off.
- Notion rate limits (429) are retried.
- CI and release builds pin Bun 1.4.4 (was 1.4.0); `dist/` is rebuilt with it.

### Consumer workflow

- Commit with `if: ${{ !cancelled() && steps.sync.outputs.changed == 'true' }}`
  and add `assets/notion` to the paths you commit (see the README example).

## [2.0.1] - 2026-09-05

### Fixed

- The Release workflow derived the moving alias from a hardcoded `v1`, so the
  first 2.x release cut through Actions would have force-moved `v1` onto a
  breaking version and silently upgraded every `@v1`-pinned site. The alias
  step now creates and moves only its own major's alias (see
  #20, fixed in
  #23), and
  [`test/release-yml.test.js`](test/release-yml.test.js) pins the alias as
  major-derived. [RELEASING.md](RELEASING.md) no longer describes generated
  sites as consuming `@v1`; the intro now states the per-major alias model
  they actually consume.

## [2.0.0] - 2026-09-05

### ⚠ Breaking

- The `summary` Action output is now a compact JSON **run summary**
  (`schema_version: 1`) instead of a one-line plain-text count. Any consumer
  workflow that parses `summary` as plain text must be updated. See
  [`docs/run-summary-schema.md`](docs/run-summary-schema.md) for the schema,
  and [RELEASING.md](RELEASING.md#compatibility-promise) — this requires a
  **major** version bump at the next release.

### Added

- A [network & data-handling contract](SECURITY.md): the complete list of
  outbound destinations (the Notion API, read-only — and nothing else in the
  engine), every input and where it goes, files written, logging/redaction
  behavior, and retention. Audited the source, the committed `dist/` bundle,
  and all dependencies for undeclared network clients — the bundle's only
  remote host is `api.notion.com` (plus two inert `@notionhq/client`
  package-metadata strings). [`test/network-contract.test.js`](test/network-contract.test.js)
  enforces the allowlists in CI, and SECURITY.md adds a maintainers'
  checklist for reviewing future dependency changes.
- Every terminal path — including a bulk-delete guard trip and an unexpected
  sync error, which previously exited with no outputs at all — now emits a
  run summary. `code` names the specific outcome (`synced`,
  `missing_credentials`, `bulk_delete_guard`, `sync_error`, `row_errors`);
  `pages`/`posts`/`data_files` are `null` (a documented fallback) either when
  that section wasn't configured or when the run didn't get far enough to
  produce real counts.
- A Markdown rendering of the same run summary is appended to
  `$GITHUB_STEP_SUMMARY` when the runner sets it, for the Actions run page.
- A durable artifact channel: the run summary is also written to the file
  named by `RUN_SUMMARY_FILE` (the Action wrapper sets it to
  `run-summary.json` under `runner.temp`), so the calling workflow can upload
  it as a workflow artifact and read it after the run — the shipped template
  workflow publishes it as the `notiongit-run-summary` artifact on every
  terminal run. The channel is observational: a failed summary-file write is
  a warning and never changes the run's exit code. See
  ["Reading the summary after the run"](docs/run-summary-schema.md#reading-the-summary-after-the-run).
  The `v1` tag predates the run-summary feature, so the next release must
  still be a **major** bump for consumers to move off `@v1` and activate the
  channel (per [RELEASING.md](RELEASING.md#compatibility-promise)).
- [`schema/run-summary.v1.json`](schema/run-summary.v1.json) — the formal,
  versioned JSON Schema for the run summary.

## [1.0.0] - 2026-09-02

Initial release of `notiongit-sync` as a reusable Bun GitHub Action.

- Composite action (`action.yml`) wrapping the Notion → Jekyll sync engine,
  consumed as `uses: OffConstruct/notiongit-sync@v1`.
- `notion_token`, `pages_database_id`, `posts_database_id`, and
  `allow_bulk_delete` inputs; `changed` and `summary` outputs.
- Generated-file contract: `_pages/*.md`, `_posts/*.md`, `_data/nav.yml`,
  `_data/home.yml`, and the managed `title`/`author.name` lines of
  `_config.yml`.
- Reproducible, committed `dist/index.js` bundle — consumer workflows never
  run `bun install`.
- Suspicious-bulk-delete guard (`MAX_DELETE_RATIO`, `ALLOW_BULK_DELETE`).
- Release process: immutable `vX.Y.Z` tags with a moving `v1` alias (see
  [RELEASING.md](RELEASING.md)).