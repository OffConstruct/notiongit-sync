# notiongit-sync

The Notion → Jekyll sync engine behind [InkDrafts](https://github.com/OffConstruct) —
packaged to be consumed by generated sites as a reusable GitHub Action
(`uses: OffConstruct/notiongit-sync@113707c94c0088b20a02853816e0ef4c784c388d`,
pinned to the v2.1.0 commit). The engine reads two Notion databases and
writes the Jekyll files a GitHub Pages site needs. Nothing else: no telemetry, no
network calls beyond the Notion API, no site content of its own.

> **Status:** the repository contains the engine as plain CommonJS source (the
> imported production script, plus the input/output plumbing the Action wrapper
> needs), the `action.yml` composite wrapper, a versioned, machine-readable
> [run summary](docs/run-summary-schema.md) published on every run, a
> committed `dist/` bundle so consumers never run `bun install`, and the
> release process that publishes `vX.Y.Z` tags and moves the release's major
> alias — see [Releasing](#releasing) below.

## Import provenance

`scripts/sync-notion.js` is a **byte-for-byte** copy of the production engine:

| | |
|---|---|
| Source | the production engine of the site InkDrafts grew out of |
| Git blob SHA | `1394ac2cc602bf525cdb4cea02e2580fe25f2132` (matches GitHub's reported blob SHA at that revision) |

The import is intentionally unmodified: no renames, no reformatting, no dependency
changes, no bug fixes. Every later behavior change should be visible as a focused
diff against this baseline. (Issue #2 is the first such diff: it adapts only the
environment/input plumbing — site-root override, boolean normalization, change
aggregation and `$GITHUB_OUTPUT` emission — leaving content conversion untouched.)

`package.json` is recreated minimally (the engine's only dependency is
`@notionhq/client`; the `sync` script entry is preserved, now invoked with `bun`
— this project runs on [Bun](https://bun.sh) rather than npm/Node, so the source
repository's Node engine range is replaced by `engines.bun`).

## How it works

```
Notion Pages DB  ─┐
                  ├─→  scripts/sync-notion.js  ─→  _data/nav.yml, _data/home.yml,
Notion Posts DB  ─┘                             ─→  _pages/{slug}.md, _posts/{date}-{slug}.md
                                                ─→  _config.yml (title, description, author.name only)
                                                ─→  assets/notion/ (copies of files uploaded to Notion)
```

- Only rows whose `Status` select equals **`Published`** are synced (both databases).
- The Notion page body is converted to Markdown: paragraphs, headings, lists
  (nested too), to-dos, code blocks with captions, quotes, callouts, dividers,
  images, videos, files, PDFs, audio, bookmarks/link previews/embeds (as
  links), toggles (as `<details>` with their contents), columns (flattened, in
  reading order), tables (GFM), synced blocks and equations (as code). Nested
  blocks are read three levels deep. Sub-pages, linked databases and anything
  deeper are left out and counted in the run summary (`skipped_blocks`).
- Files uploaded to Notion (photos, videos, PDFs, cover images, the profile
  photo) are copied into `assets/notion/` and linked from there, because
  Notion's own links expire after an hour. A copy is named after the file's
  URL without its signature, so it is downloaded once; copies no page links
  to any more are deleted. Files over 20 MB, file types a website can't
  show, and URLs outside Notion's file hosts are left out and named in the
  run summary (`skipped`). See [SECURITY.md](SECURITY.md#outbound-network-destinations).
- Text that looks like Liquid (`{{` or `{%`) is wrapped in `{% raw %}`, so
  writing about templates can't break the Jekyll build.
- Writes are diffed: a file is rewritten only when its content would change.
- Files carry a `notion_id` front-matter key; **only files with a `notion_id` are
  managed** — hand-added Markdown files in `_pages/`/`_posts/` are never deleted.
  (Caveat: a hand-added file whose name collides with a generated
  `{slug}.md` / `{date}-{slug}.md` is overwritten by that row's output — the
  `notion_id` check guards deletion, not name collisions.) Slug (or date) renames
  in Notion delete the old file and write the new one.
- Two published rows that would write the same file: the row that already
  owns it keeps it (otherwise the first row Notion returns), and the other is
  reported as a row error (`duplicate_web_address`).
- Posts dated in the future are left out until the first run on or after
  that date. They count as present, so an already-published post moved to a
  later date is kept, not deleted.

### Runtime expectations

[Bun](https://bun.sh) ≥ 1.1 is this project's runtime and package manager — plain
CommonJS with no Node- or Bun-specific APIs, so the script runs unmodified
(`bun scripts/sync-notion.js`; the Action wrapper installs Bun on GitHub-hosted
runners via [`oven-sh/setup-bun`](https://github.com/oven-sh/setup-bun), pinned to a full commit SHA). The
script resolves the Jekyll site root as the parent of `scripts/`
(`path.resolve(__dirname, '..')`) unless `SITE_ROOT` says otherwise — in this
repository it is engine source, not a runnable site. When the Action wrapper runs
it, a composite action's own files live under `_actions/`, outside the consumer's
workspace, so the wrapper points `SITE_ROOT` at `$GITHUB_WORKSPACE` and the
engine writes into the site checkout that called it.

### The committed bundle (`dist/`)

`action.yml` runs `dist/index.js`, not `scripts/sync-notion.js` directly.
`dist/index.js` is generated by `bun run build`
(`bun build ./scripts/sync-notion.js --outfile dist/index.js --target bun`) and
committed, so a consumer's scheduled sync never runs `bun install` — no
network install, and no lockfile-resolution failure, on every run. See
[`dist/README.md`](dist/README.md) for the regeneration rule and third-party
notices. CI rebuilds and diffs `dist/` on every push/PR and fails if it's
stale; never hand-edit anything under `dist/`.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `NOTION_TOKEN` | **Yes** | Notion integration secret. Missing or whitespace-only → clean no-op (exit 0), before any I/O. |
| `NOTION_PAGES_DATABASE_ID` | One of the two DB IDs | ID of the Pages database (below). Unset → pages sync skipped. |
| `NOTION_POSTS_DATABASE_ID` | One of the two DB IDs | ID of the Posts database (below). Unset → posts sync skipped. |
| `NOTION_DATABASE_ID` | No | Legacy fallback for the posts database; used only when `NOTION_POSTS_DATABASE_ID` is unset. |
| `ALLOW_BULK_DELETE` | No | `true` (case-insensitive — the Action input normalizes `True`/`TRUE` too) to bypass the bulk-delete guard (below). |
| `MAX_DELETE_RATIO` | No | Fraction of tracked files a sync may delete before the guard trips. Default `0.5`. A value of `0` — or any non-numeric value — silently falls back to `0.5` (`Number(x) \|\| 0.5`); a negative value trips the guard on any multi-file deletion, and a value above `1` disables the ratio check. |
| `SITE_ROOT` | No | Root of the Jekyll site to write into. Default: the parent of `scripts/`. The Action wrapper sets it to `$GITHUB_WORKSPACE`. |
| `NOTION_BASE_URL` | No | Test hook: overrides the Notion API origin (`https://api.notion.com` by default) so the local harness can serve a fake API. Never set in production. |
| `GITHUB_OUTPUT` | No | Set by the runner when the engine runs as an Action step; the engine appends the `changed` / `summary` outputs (below) to it. |
| `GITHUB_STEP_SUMMARY` | No | Set by the runner for every step; the engine appends a Markdown rendering of the run summary (below) to it. |

At least one of `NOTION_PAGES_DATABASE_ID` / `NOTION_POSTS_DATABASE_ID` (or the
legacy `NOTION_DATABASE_ID`) must be set alongside `NOTION_TOKEN`. If neither
credential is usable (absent, empty, or whitespace-only), the script does not
query anything or touch the filesystem — it exits 0 with `changed=false` and a
summary naming the missing key, so a scheduled run that lands before secrets
are provisioned stays green instead of failing loudly. See
[Clean no-op on missing credentials](#clean-no-op-on-missing-credentials).

## Notion database schemas

These are the properties the engine reads. Each canonical name lists the
alternate property names it also accepts (useful when duplicating an existing
database); columns marked *default* apply when the property is empty or absent.
Notion property names are case-sensitive. The v2 InkDrafts template uses the
plain names in **bold**; v1 copies keep working.

Every text value is read whole: a title with a bold word in the middle is
not cut off at the formatting.

### Pages database (`NOTION_PAGES_DATABASE_ID`) — one row = one site section

| Property | Type | Meaning |
|---|---|---|
| **`Title`** (whichever property has Notion's Title type) | Title | Page name; used as nav label and page heading. Default `Untitled`. |
| `Slug` (or `slug`, **`Web address`**, `Web Address`) | Text | URL path segment, e.g. `about`. See [Web addresses](#web-addresses). |
| **`Type`** (or `type`) | Select | `home`, `blog-list`, `blog`, or `markdown` (default) — see mapping below. Matched case-insensitively (`Home`, `Blog-List` also work). The v2 labels **`Home page`**, **`List of posts`** and **`Regular page`** mean `home`, `blog-list` and `markdown`. |
| `Nav Order` (or `Nav order`, `Order`, **`Menu order`**, `Menu Order`) | Number | Sort order in the header nav. Default `99`. |
| `Show in Nav` (or `Show In Nav`, `Nav`, **`Show in menu`**, `Show in Menu`) | Checkbox | Include in `_data/nav.yml`. Default `false`. |
| **`Status`** | Select | Must be `Published` to sync (query filter). |
| `Description` (or `Excerpt`, **`Summary`**) | Text | Optional meta description → page front matter. On the `home` row, used as the site description when `Tagline` is empty. |
| **`Name`** (or `Display Name`, `Author Name`) | Text | Display name on the home page (`home` type only); falls back to `Title`. Also written to `_config.yml` as `title` and `author.name`. |
| `Profile Picture` (or `Avatar`, **`Photo`**) | Files & media, or Text | `home` type only. Files & media: the first file (an upload is copied into `assets/notion/`). Text: an image URL, used as written. |
| **`Tagline`** (or `Short Bio`, `Subtitle`) | Text | One-line bio (`home` type only). Also written to `_config.yml` as `description`, for search results and link previews. |
| `Social Links` (or `Socials`, **`Links`**) | Text | Newline-separated `Name: URL` pairs (`home` type only). |

`Social Links` format:

```
GitHub: https://github.com/username
Twitter: https://twitter.com/handle
Email: mailto:user@example.com
```

A URL beginning with `//` is prefixed with `https:`; any other scheme-less value
is kept as written.

The Notion page body of a `home` row becomes the home page bio; the body of any
other row becomes that page's Markdown content.

#### `Type` → Jekyll layout

| Notion `Type` | Jekyll layout | URL |
|---|---|---|
| `home` | — (no `_pages/` file; writes `_data/home.yml` and updates `_config.yml`) | `/` |
| `blog-list` or `blog` | `blog` | `/{slug}/` |
| `markdown` (default) | `page` | `/{slug}/` |

#### Web addresses

A row's slug is decided in this order:

1. A typed `Slug` / `Web address` that is already safe in a URL and a file
   name (`[A-Za-z0-9][A-Za-z0-9_-]*`) is used exactly as typed. Anything else
   is cleaned up: accents dropped, other characters turned into hyphens
   (`Mi viaje: día 1` → `mi-viaje-dia-1`).
2. With no typed value, the slug the row's current file already has is kept,
   so fixing a typo in a title never breaks a shared link.
3. Otherwise the cleaned-up title, and failing that (a title with no Latin
   letters) `page-` plus the first 8 characters of the row id.

The slug is always written quoted in front matter.

### Posts database (`NOTION_POSTS_DATABASE_ID`; legacy `NOTION_DATABASE_ID`) — one row = one blog post

| Property | Type | Meaning |
|---|---|---|
| **`Title`** (whichever property has Notion's Title type) | Title | Post title. Default `Untitled`. |
| `Slug` (or `slug`, **`Web address`**, `Web Address`) | Text | URL slug. See [Web addresses](#web-addresses). |
| **`Status`** | Select | Must be `Published` to sync (query filter). |
| `Publish Date` (or **`Date`**, `Published`) | Date | Publish date → filename and front matter. Empty: the day the row was created (not today, which would move the post's address every day). A future date holds the post back until that day. |
| **`Tags`** | Multi-select | Tags → post front matter. |
| `Description` (or `Excerpt`, **`Summary`**) | Text | Optional excerpt → post front matter. |
| `Cover Image` (or **`Cover image`**, `Cover`) | Files & media | First file. An upload is copied into `assets/notion/`; an external link is used as written. |
| `Canonical URL` (or **`Originally published at`**) | URL | Optional canonical link → post front matter. |
| **`Featured`** | Checkbox | `featured: true` in post front matter when checked. |

## Generated-file contract

All of these are **sync-managed**: never edited by hand, changes are overwritten.

| File | Generated from | Contents |
|---|---|---|
| `_data/home.yml` | The `home`-type row | `name`, `tagline`, `profile_picture`, `social_links` (list of `{name, url}`), `bio` (page body as a YAML literal block), `notion_id`. Written only when a published `home` row exists. |
| `_data/nav.yml` | All rows with `Show in Nav` checked | List of `{title, url}` sorted by `Nav Order`; `url` is `/` for `home`, else `/{slug}`. Empty list writes `[]`. |
| `_pages/{slug}.md` | Each published non-`home` row | Front matter `layout`, `title`, `slug`, optional `description`, `notion_id`; body = page content. |
| `_posts/{date}-{slug}.md` | Each published post row | Front matter `layout: post`, `title`, `date`, `slug`, optional `tags`, `excerpt`, `cover_image`, `canonical_url`, `featured`, `notion_id`; body = post content. |
| `_config.yml` | The `Name` and `Tagline` (or `Summary`) of the `home` row | **Only** the top-level `title:`, `description:` and the `author.name:` lines are rewritten, line by line, so comments and ordering survive. With no Tagline or Summary, `description:` is left as it is (the old template default `A Notion-powered Jekyll site.` is replaced by a neutral one). `url`, `baseurl`, and everything else are never touched. Unrecognized shapes are left alone and warned about. |
| `assets/notion/{hash}-{name}.{ext}` | Files uploaded to Notion | Copies of the files the generated pages link to, linked as `{baseurl}/assets/notion/…`. Unlinked copies are deleted at the end of each run. |

### Bulk-delete guard

Unpublishing rows in Notion deletes the corresponding files — but a section
(pages or posts) that returns **zero published rows while tracked files
exist** (every tracked file looks unpublished), or that would delete **more
than two files while exceeding `MAX_DELETE_RATIO`** (default 0.5) of the
tracked files, **holds those deletions back**. A dropped `Status` option, a
revoked integration share, or a partial API response is indistinguishable from
a real mass unpublish, and the consumer workflow commits the sync's output
straight to the site's default branch — so the guard keeps the files and asks.

The guard works per section. The held-back section still writes its other
changes (new and edited rows), but keeps `_data/nav.yml`, `_data/home.yml`
and `_config.yml` as they were, since that read is not trusted. The other
section syncs normally. The run reports `code: "bulk_delete_guard"`, lists
the rows that would go in `affected` (by title), sets `changed` for whatever
was written, and exits 1. A consumer workflow that commits when
`changed == 'true'` and the job was not cancelled (see the example below)
keeps every other change of the run.

Always allowed:

- Removing only the template's example post (web address
  `welcome-to-inkdrafts`), even though that leaves zero published posts.
- One or two deletions, as long as Notion returned at least one published
  row in that section.

Push a genuine mass unpublish through with `ALLOW_BULK_DELETE=true`.

### Clean no-op on missing credentials

A newly generated repository can receive its first scheduled run before
provisioning has written `NOTION_TOKEN` / the database ID(s) — that must not
look like a broken Action to a non-developer. So when `NOTION_TOKEN` is
missing, or neither database ID is set (absent, empty, or whitespace-only in
either case), the engine exits 0 with `changed=false` and a run summary
(`code: "missing_credentials"`) whose `detail` names the missing
configuration key (e.g. `skipped: NOTION_TOKEN environment variable is not
set.`) — before constructing the Notion client or touching any generated
file. It never reveals which secret value was present, only the name of
what's missing.

### Exit codes

`0` — clean sync (possibly all-unchanged), a no-op skip when Notion
credentials aren't configured yet (above), or a sync where some rows could
not be published (`row_errors`: the rest of the site still updates, the run
logs a `::warning::`, and the rows are named in the run summary's
`affected`). `1` — a database query failed (`sync_error`, `changed` is
false) or the bulk-delete guard held deletions back (`bulk_delete_guard`,
`changed` reflects the rest of the run). The caller (the site's workflow)
decides what to commit. Every one of these outcomes emits a run summary
(above) — a non-zero exit never means the outputs are empty.

## Usage as a GitHub Action

```yaml
- uses: OffConstruct/notiongit-sync@113707c94c0088b20a02853816e0ef4c784c388d # v2.1.0
  id: sync
  with:
    notion_token: ${{ secrets.NOTION_TOKEN }}
    pages_database_id: ${{ secrets.NOTION_PAGES_DATABASE_ID }}
    posts_database_id: ${{ secrets.NOTION_POSTS_DATABASE_ID }}
```

Run it after `actions/checkout` in the site's own repository (the engine writes
into the checkout, not the action's copy). A complete consumer workflow:

```yaml
name: Sync from Notion
on:
  schedule: [{ cron: '0 * * * *' }]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: OffConstruct/notiongit-sync@113707c94c0088b20a02853816e0ef4c784c388d # v2.1.0
        id: sync
        with:
          notion_token: ${{ secrets.NOTION_TOKEN }}
          pages_database_id: ${{ secrets.NOTION_PAGES_DATABASE_ID }}
          posts_database_id: ${{ secrets.NOTION_POSTS_DATABASE_ID }}
      - name: Commit synced content
        # !cancelled(): a run whose deletions were held back exits 1, but its
        # other changes are real and must still be committed.
        if: ${{ !cancelled() && steps.sync.outputs.changed == 'true' }}
        run: |
          git config user.name  "notiongit-sync"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          for path in _pages _posts _data _config.yml assets/notion; do
            if [ -e "$path" ]; then git add -A -- "$path"; fi
          done
          git commit -m "chore: sync from Notion" || exit 0
          git push
```

### Inputs

| Input | Required | Default | Maps to |
|---|---|---|---|
| `notion_token` | **Yes** | — | `NOTION_TOKEN` |
| `pages_database_id` | No | `''` | `NOTION_PAGES_DATABASE_ID` — empty skips the pages sync |
| `posts_database_id` | No | `''` | `NOTION_POSTS_DATABASE_ID` — empty skips the posts sync unless the legacy `NOTION_DATABASE_ID` env var is set |
| `allow_bulk_delete` | No | `'false'` | `ALLOW_BULK_DELETE`, normalized case-insensitively (`true`/`True`/`TRUE`) |

`MAX_DELETE_RATIO` stays environment-only: set it in the calling workflow's
`env:` and the action's sync step inherits it.

### Outputs

| Output | Meaning |
|---|---|
| `changed` | `"true"` when any tracked file was created, updated, renamed or deleted this run — including `_data/nav.yml`, `_data/home.yml` and the managed lines of `_config.yml`. Independent of success/failure: a `row_errors` failure can still be `"true"` if some rows were written before another row failed. `"false"` when nothing was ever written. Every terminal path emits this output (a failed step still fails the job). |
| `summary` | Compact, non-secret JSON **run summary** (`schema_version: 1`), e.g. `{"schema_version":1,"result":"success","code":"synced","changed":true,...,"detail":"pages: 1 created, ..."}`. Every terminal outcome — success, no-op, a guarded deletion, or an unexpected sync error — emits one. See [`docs/run-summary-schema.md`](docs/run-summary-schema.md) for the full field reference, the `result`/`code` table, and example payloads for every outcome, and [`schema/run-summary.v1.json`](schema/run-summary.v1.json) for the formal schema. |

The token is passed to the engine through its environment only; it is never
echoed, logged, or written to outputs.

### Run summary

Beyond the `summary` output above, the engine also appends a Markdown
rendering of the same run summary to `$GITHUB_STEP_SUMMARY` when the runner
sets it (every step gets one) — a human-readable version on the Actions run
page, alongside the machine-readable JSON. Both are built from the same data
and carry the same non-secret guarantee. See
[`docs/run-summary-schema.md`](docs/run-summary-schema.md) for details.

Every terminal run also publishes the summary as a workflow artifact named
`notiongit-run-summary` (file `run-summary.json`), so it stays readable after
the run: the Action writes the JSON under `runner.temp` and the shipped
template workflow uploads it. How to read it back through the Actions
artifacts API — including the retention and fallback rules — is documented in
[Reading the summary after the run](docs/run-summary-schema.md#reading-the-summary-after-the-run).

## Usage

```bash
bun install
NOTION_TOKEN=secret NOTION_PAGES_DATABASE_ID=… NOTION_POSTS_DATABASE_ID=… bun run sync
```

## Development

```bash
bun install --frozen-lockfile
bun run build   # regenerate dist/index.js after changing scripts/sync-notion.js
bun test        # unit tests + action.yml contract tests + the local Action harness
```

After changing `scripts/sync-notion.js`, run `bun run build` and commit the
resulting `dist/index.js` in the same change — CI fails the build if `dist/`
doesn't match a fresh rebuild (`git diff --exit-code` after `bun run build`).

The harness (`test/harness.test.js`) runs the engine as a real subprocess
against a fake Notion API served on `localhost` (`NOTION_BASE_URL`) and a
throwaway site (`SITE_ROOT`), with exactly the environment the `action.yml`
step sets — proving input mapping, boolean normalization, `$GITHUB_OUTPUT`
and `$GITHUB_STEP_SUMMARY` emission, the bulk-delete guard, a simulated
Notion API failure, Notion's `has_more`/`next_cursor` pagination, and the
legacy posts-only fallback end to end, with no network access and no real
workspace data. `test/conversion.test.js` unit-tests the pure Notion →
Markdown/front-matter conversion logic (rich text, every block type, list
grouping, slugging) directly, with no subprocess or fake server needed.
`test/dist.test.js` runs the same kind of check directly against the
committed `dist/index.js` bundle, so a stale or miscompiled bundle fails
tests even if `git diff` were skipped. `test/run-summary-schema.test.js`
validates a representative payload for every terminal outcome against
[`schema/run-summary.v1.json`](schema/run-summary.v1.json) and covers secret
redaction — see [`docs/run-summary-schema.md`](docs/run-summary-schema.md).
`test/network-contract.test.js` pins the network contract
([`SECURITY.md`](SECURITY.md)): the only endpoint hosts in the engine and
bundle, the single runtime dependency, the allowed `uses:` steps, and that
`SECURITY.md` itself stays in sync with those allowlists.

## Security & network contract

Where your Notion token and content can and cannot go — the complete list of
outbound destinations, inputs, files written, logging/redaction behavior, and
retention — is documented in [`SECURITY.md`](SECURITY.md). The engine's only
endpoint is the Notion API (read-only); there is no telemetry of any kind.
The contract is enforced by
[`test/network-contract.test.js`](test/network-contract.test.js), which fails
CI on any undeclared endpoint, dependency, or Action reference, and
[`SECURITY.md`](SECURITY.md) carries the maintainers' checklist for reviewing
future dependency changes.

## Releasing

Generated sites consume `uses: OffConstruct/notiongit-sync`, pinned to an immutable
full commit SHA (`OffConstruct/notiongit-sync@113707c94c0088b20a02853816e0ef4c784c388d`, `# v2.1.0`),
so a site's version moves only when the template bumps its pin. The `vX` major
aliases still move on every release; consumers who prefer automatic updates can
pin an alias instead, at their own risk, while full `vX.Y.Z` tags remain
immutable once published. See [`RELEASING.md`](RELEASING.md) for the
compatibility promise (what's patch/minor/major), the release workflow, and
rollback instructions, and [`CHANGELOG.md`](CHANGELOG.md) for what shipped in
each version.

## License

TBD — tracked in `notiongit-template` #9 at the org level.
