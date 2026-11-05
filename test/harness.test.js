/**
 * Local Action harness: proves the full input → engine → output contract
 * without touching the real Notion API.
 *
 * A fake Notion server (Bun.serve on an ephemeral port) serves the two
 * endpoints the engine uses — POST /v1/databases/{id}/query and
 * GET /v1/blocks/{id}/children — from synthetic fixtures. The engine is run as
 * a real subprocess (`bun scripts/sync-notion.js`) with exactly the environment
 * the action.yml step would set, pointed at a throwaway Jekyll site via
 * SITE_ROOT and at the fake API via NOTION_BASE_URL (a test-only hook).
 *
 * All fixtures are synthetic (hex-UUID ids, placeholder text) — nothing here
 * comes from a real workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { schema, validateAgainstSchema } = require('./support/run-summary-validator.js');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const TOKEN = 'secret-test-token-never-print-me';

// Synthetic IDs — hex-only so they match the engine's notion_id regex.
const PAGES_DB = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const POSTS_DB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const LEGACY_POSTS_DB = 'cccccccc-3333-4333-8333-cccccccccccc';
// Queried by the "API failure" scenario below: the fake server answers this
// id with a real Notion-shaped error response instead of a result list.
const FAILING_DB = '99999999-9999-4999-8999-999999999999';
// Queried by the "row errors" scenario below: the fake server answers this
// page's block children with a real Notion-shaped error instead of a body,
// while every other row syncs — the per-row failure behind code=row_errors.
const ERRORING_PAGE_ID = '70707070-7070-4707-8707-707070707070';
const HOME_ID  = 'dddddddd-4444-4444-8444-dddddddddddd';
const ABOUT_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const POST_ID  = 'ffffffff-6666-4666-8666-ffffffffffff';
const PAGINATED_ID = '99999999-1111-4111-8111-999999999999';

// ─── Fake Notion fixtures ─────────────────────────────────────────────────────

const titleProp  = (t) => ({ title: [{ plain_text: t }] });
const textProp   = (t) => ({ rich_text: [{ plain_text: t }] });
const paragraph  = (t) => ({
  id: '12345678-90ab-4cdef-890-abcdef123456'.slice(0, 36),
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: t, annotations: {}, href: null }] },
});
const row = (id, properties) => ({ id, object: 'page', properties });

const homeRow = () =>
  row(HOME_ID, {
    Title: titleProp('Home'),
    Type: { select: { name: 'home' } },
    'Show in Nav': { checkbox: true },
    'Nav Order': { number: 1 },
    Name: textProp('Test Author'),
    Tagline: textProp('Test tagline'),
    'Profile Picture': textProp('https://example.com/pic.png'),
    'Social Links': textProp('GitHub: https://github.com/example'),
  });

const aboutRow = (slug = 'about') =>
  row(ABOUT_ID, {
    Title: titleProp('About'),
    Slug: textProp(slug),
    Type: { select: { name: 'markdown' } },
    'Show in Nav': { checkbox: true },
    'Nav Order': { number: 2 },
  });

const paginatedRow = (slug = 'paginated') =>
  row(PAGINATED_ID, {
    Title: titleProp('Paginated'),
    Slug: textProp(slug),
    Type: { select: { name: 'markdown' } },
  });

const postRow = () =>
  row(POST_ID, {
    Title: titleProp('Hello World'),
    Slug: textProp('hello-world'),
    'Publish Date': { date: { start: '2026-01-15' } },
    Tags: { multi_select: [{ name: 'testing' }] },
  });

// Mutable server state — scenarios adjust it between runs.
const state = {
  pages: [],
  posts: [],
  files: {},
  fileFetches: [],
  blocks: {
    [HOME_ID]:  [paragraph('Home bio paragraph.')],
    [ABOUT_ID]: [paragraph('About body paragraph.')],
    [POST_ID]:  [paragraph('Post body paragraph.')],
  },
};

function resetFixtures() {
  state.pages = [homeRow(), aboutRow()];
  state.posts = [postRow()];
  state.blocks[ABOUT_ID] = [paragraph('About body paragraph.')];
}

// ─── Fake Notion server ───────────────────────────────────────────────────────

// Deliberately small: forces the fake server to answer every multi-row/
// multi-block fixture across several has_more:true pages instead of ever
// returning everything in one response, exercising fetchPublished's and
// fetchAllBlocks's start_cursor loop the way the real Notion API would for
// any database or block list past a handful of rows. Transparent to every
// existing scenario below — fetchPublished/fetchAllBlocks aggregate all pages
// before returning, so the final result is identical regardless of page size.
const PAGE_SIZE = 1;

/** Slice `items` into one Notion-shaped paginated response. */
function paginate(items, cursor) {
  const start = cursor ? Number(cursor) : 0;
  const end   = Math.min(start + PAGE_SIZE, items.length);
  return {
    results:     items.slice(start, end),
    has_more:    end < items.length,
    next_cursor: end < items.length ? String(end) : null,
  };
}

let server;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      const dbQuery = url.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/);
      if (dbQuery && req.method === 'POST') {
        if (dbQuery[1] === FAILING_DB) {
          // Shaped like a real Notion API error: @notionhq/client surfaces
          // `message` verbatim on the thrown APIResponseError, and Notion's
          // real "not found" message echoes the database ID back — exactly
          // the kind of text the run summary's redaction has to catch.
          return Response.json({
            object: 'error',
            status: 404,
            code: 'object_not_found',
            message: `Could not find database with ID: ${FAILING_DB}. Make sure the relevant pages and databases are shared with your integration.`,
          }, { status: 404 });
        }
        const rows = dbQuery[1] === PAGES_DB ? state.pages
                   : dbQuery[1] === POSTS_DB || dbQuery[1] === LEGACY_POSTS_DB ? state.posts
                   : [];
        const body = await req.json().catch(() => ({}));
        const page = paginate(rows, body.start_cursor);
        return Response.json({ object: 'list', ...page });
      }

      const blockChildren = url.pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/);
      if (blockChildren && req.method === 'GET') {
        if (blockChildren[1] === ERRORING_PAGE_ID) {
          // Shaped like a real Notion API error the same way FAILING_DB is:
          // the engine's per-row catch must turn it into counts in the run
          // summary, never echo this message (which names the id).
          return Response.json({
            object: 'error',
            status: 404,
            code: 'object_not_found',
            message: `Could not find block with ID: ${ERRORING_PAGE_ID}. Make sure the relevant pages and databases are shared with your integration.`,
          }, { status: 404 });
        }
        const items = state.blocks[blockChildren[1]] ?? [];
        const page  = paginate(items, url.searchParams.get('start_cursor'));
        return Response.json({ object: 'list', ...page });
      }

      // Notion-hosted files. Every block read signs the URL afresh (a new
      // query string each time), the way Notion's S3 links behave.
      const file = url.pathname.match(/^\/files\/(.+)$/);
      if (file && req.method === 'GET') {
        const served = state.files[decodeURIComponent(file[1])];
        if (!served) return new Response('missing', { status: 404 });
        state.fileFetches.push(file[1]);
        return new Response(served.body, { headers: { 'content-type': served.type } });
      }

      return new Response('harness: not found', { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ─── Harness helpers ──────────────────────────────────────────────────────────

const tempDirs = [];

function makeSite() {
  const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-site-'));
  tempDirs.push(dir);
  writeFileSync(
    path.join(dir, '_config.yml'),
    'title: "Old Title"\nauthor:\n  name: "Old Name"\nurl: https://example.github.io\n# keep my comments\n'
  );
  return dir;
}

function makeOutputFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-out-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'github_output');
  writeFileSync(file, '');
  return file;
}

function makeSummaryFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-summary-'));
  tempDirs.push(dir);
  return path.join(dir, 'run-summary.json');
}

async function runEngine(env) {
  const proc = Bun.spawn(['bun', 'scripts/sync-notion.js'], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function baseEnv(siteRoot, overrides = {}) {
  return {
    NOTION_TOKEN: TOKEN,
    NOTION_PAGES_DATABASE_ID: PAGES_DB,
    NOTION_POSTS_DATABASE_ID: POSTS_DB,
    NOTION_BASE_URL: `http://127.0.0.1:${server.port}`,
    SITE_ROOT: siteRoot,
    RUN_SUMMARY_FILE: makeSummaryFile(),
    ...overrides,
  };
}

/** Parse a $GITHUB_OUTPUT file the way the runner does (simple + heredoc). */
function parseGithubOutput(text) {
  const lines = text.split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const simple = lines[i].match(/^(\w+)=(.*)$/);
    if (simple) {
      out[simple[1]] = simple[2];
      continue;
    }
    const heredoc = lines[i].match(/^(\w+)<<(.+)$/);
    if (heredoc) {
      const value = [];
      for (let j = i + 1; j < lines.length && lines[j] !== heredoc[2]; j++) value.push(lines[j]);
      out[heredoc[1]] = value.join('\n');
    }
  }
  return out;
}

const outputsOf = async (env, file) => {
  // A fresh artifact path per call: the shared `env` below is reused across
  // scenarios, and each one's file assertions must read its own run.
  const summaryFile = makeSummaryFile();
  const result = await runEngine({ ...env, GITHUB_OUTPUT: file, RUN_SUMMARY_FILE: summaryFile });
  return { result, outputs: parseGithubOutput(readFileSync(file, 'utf8')), summaryFile };
};

function readRunSummaryArtifact(file, expectedCode) {
  expect(existsSync(file)).toBe(true);
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  expect(() => validateAgainstSchema(schema, summary, schema.$defs)).not.toThrow();
  expect(summary.code).toBe(expectedCode);
  return summary;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

// Scenarios below share one `site` checkout and run in file order (Bun runs a
// describe block's tests in declaration order, not in parallel or shuffled).
// This is deliberate: the engine's whole behavior is incremental — create,
// then re-sync unchanged, then edit, then rename, then delete — so each
// scenario's expectations depend on the site state the previous one left on
// disk, exactly as consecutive scheduled runs of the real Action would. A
// scenario that needs an independent site (the bulk-delete-ratio and legacy
// fallback scenarios) makes its own via makeSite().
describe('local Action harness (fake Notion API + engine subprocess)', () => {
  let site;
  let outFile;
  let env;

  beforeAll(() => {
    resetFixtures();
    site = makeSite();
    outFile = makeOutputFile();
    env = baseEnv(site);
  });

  it('exits cleanly as a no-op — not a failure — when credentials are absent or blank, before any I/O', async () => {
    const cases = [
      ['absent token', { NOTION_TOKEN: '' }, 'NOTION_TOKEN'],
      ['whitespace-only token', { NOTION_TOKEN: '   ' }, 'NOTION_TOKEN'],
      ['absent database ids', { NOTION_PAGES_DATABASE_ID: '', NOTION_POSTS_DATABASE_ID: '' }, 'DATABASE_ID'],
      ['whitespace-only database ids', { NOTION_PAGES_DATABASE_ID: ' ', NOTION_POSTS_DATABASE_ID: '\t\n' }, 'DATABASE_ID'],
    ];

    for (const [, overrides, expectedMention] of cases) {
      const caseOutFile = makeOutputFile();
      const { result, outputs, summaryFile } = await outputsOf(baseEnv(site, overrides), caseOutFile);

      // A no-op is not an error: exit 0, no stderr, no scary log lines.
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(outputs.changed).toBe('false');
      expect(outputs.summary).toContain(expectedMention);

      // No filesystem changes — the credential check runs before any I/O.
      expect(existsSync(path.join(site, '_pages'))).toBe(false);
      expect(existsSync(path.join(site, '_posts'))).toBe(false);
      expect(existsSync(path.join(site, '_data'))).toBe(false);

      // Never reveals a secret value, only names the missing key.
      expect(result.stdout + outputs.summary).not.toContain(TOKEN);

      expect(readRunSummaryArtifact(summaryFile, 'missing_credentials'))
        .toEqual(JSON.parse(outputs.summary));
    }
  });

  it('the no-op path also exits 0 without GITHUB_OUTPUT set (a plain local run)', async () => {
    const localEnv = baseEnv(site, { NOTION_TOKEN: '' });
    const result = await runEngine(localEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Notion sync skipped');
    expect(result.stdout).toContain('NOTION_TOKEN');
    expect(existsSync(path.join(site, '_pages'))).toBe(false);
    readRunSummaryArtifact(localEnv.RUN_SUMMARY_FILE, 'missing_credentials');
  });

  it('first sync writes the site and reports changed=true', async () => {
    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);

    // Pages: about.md with front matter, body and notion_id.
    const about = readFileSync(path.join(site, '_pages', 'about.md'), 'utf8');
    expect(about).toContain('title: "About"');
    expect(about).toContain('slug: "about"');
    expect(about).toContain(`notion_id: "${ABOUT_ID}"`);
    expect(about).toContain('About body paragraph.');

    // Posts: dated filename with layout: post.
    const post = readFileSync(path.join(site, '_posts', '2026-01-15-hello-world.md'), 'utf8');
    expect(post).toContain('layout: post');
    expect(post).toContain('title: "Hello World"');
    expect(post).toContain('Post body paragraph.');

    // Data files.
    const nav = readFileSync(path.join(site, '_data', 'nav.yml'), 'utf8');
    expect(nav).toContain('title: "Home"');
    expect(nav).toContain('url: "/"');
    expect(nav).toContain('url: "/about"');
    const home = readFileSync(path.join(site, '_data', 'home.yml'), 'utf8');
    expect(home).toContain('name: "Test Author"');
    expect(home).toContain('bio: |');
    expect(home).toContain('Home bio paragraph.');

    // _config.yml: only the managed identity lines change; comments survive.
    const config = readFileSync(path.join(site, '_config.yml'), 'utf8');
    expect(config).toContain('title: "Test Author"');
    expect(config).toContain('name: "Test Author"');
    expect(config).toContain('# keep my comments');
    expect(config).toContain('url: https://example.github.io');

    // Outputs: changed=true, non-secret summary.
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('pages: 1 created');
    expect(outputs.summary).toContain('posts: 1 created');
    expect(outputs.summary).toContain('nav.yml');

    // Credentials never reach outputs or logs.
    const outFileText = readFileSync(outFile, 'utf8');
    expect(outFileText).not.toContain(TOKEN);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);

    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('re-sync with unchanged content reports changed=false', async () => {
    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);
    expect(outputs.changed).toBe('false');
    expect(outputs.summary).toContain('unchanged');
    expect(outputs.summary).not.toMatch(/[1-9]\d* (created|updated|renamed|deleted)/);
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('content edits in Notion flip changed back to true', async () => {
    state.blocks[ABOUT_ID] = [paragraph('Edited body paragraph.')];

    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('1 updated');
    expect(readFileSync(path.join(site, '_pages', 'about.md'), 'utf8'))
      .toContain('Edited body paragraph.');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('slug renames move the file, report a rename, and are not also double-counted as updated', async () => {
    state.pages = [homeRow(), aboutRow('about-renamed')];

    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(site, '_pages', 'about.md'))).toBe(false);
    expect(existsSync(path.join(site, '_pages', 'about-renamed.md'))).toBe(true);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('1 renamed');
    // A rename is one change, not two: it must not also count as "updated".
    expect(outputs.summary).toContain('0 updated');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('bulk-delete guard holds back deletions on zero published rows, deletes nothing, and still emits a failure run summary', async () => {
    state.pages = []; // "misread": every tracked page looks unpublished
    const aboutPath = path.join(site, '_pages', 'about-renamed.md');
    const before = readFileSync(aboutPath, 'utf8');
    const guardOutFile  = makeOutputFile();
    const stepSummaryFile = makeOutputFile();

    const result = await runEngine({ ...env, GITHUB_OUTPUT: guardOutFile, GITHUB_STEP_SUMMARY: stepSummaryFile });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('HELD BACK');
    const navBefore = readFileSync(path.join(site, '_data', 'nav.yml'), 'utf8');
    expect(readFileSync(aboutPath, 'utf8')).toBe(before); // untouched
    // An untrusted read keeps the menu as it was, too.
    expect(navBefore).toContain('url: "/about-renamed"');

    // Both sections ran to the end, so their counts are real; nothing
    // changed because the only change on offer was the held-back deletion.
    const outputs = parseGithubOutput(readFileSync(guardOutFile, 'utf8'));
    expect(outputs.changed).toBe('false');
    const summary = JSON.parse(outputs.summary);
    expect(summary.schema_version).toBe(1);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('bulk_delete_guard');
    expect(summary.pages.deleted).toBe(0);
    expect(summary.posts).not.toBeNull();
    expect(summary.detail).not.toContain('about-renamed'); // no filenames — counts only
    expect(summary.detail).toMatch(/for pages: would delete 1 of 1/);
    // The owner's dashboard names what would go.
    expect(summary.affected).toEqual([
      { section: 'pages', title: 'About', reason_code: 'would_remove', reason: expect.any(String) },
    ]);

    const stepSummary = readFileSync(stepSummaryFile, 'utf8');
    expect(stepSummary).toContain('bulk_delete_guard');
    expect(stepSummary).not.toContain('about-renamed');

    // exit 1, yet the artifact round-trips: it was written before process.exit.
    expect(readRunSummaryArtifact(env.RUN_SUMMARY_FILE, 'bulk_delete_guard')).toEqual(summary);
  });

  it('bulk-delete guard also aborts on a ratio breach with multiple published rows (not just zero)', async () => {
    // Track four pages, then have Notion report only one published: 3 of 4
    // stale (75%) exceeds MAX_DELETE_RATIO's 0.5 default, with processedIds
    // non-empty — the ratio branch of the guard, distinct from the
    // zero-published-rows branch covered above.
    const ratioSite = makeSite();
    const seedEnv = baseEnv(ratioSite);

    // Ids must match the engine's notion_id extraction regex ([a-f0-9-]{36}),
    // so these stay hex — plain slugs like "extra-a" would not round-trip.
    const extraPages = [
      { id: '11111111-1111-4111-8111-111111111111', slug: 'extra-a' },
      { id: '22222222-1111-4111-8111-111111111111', slug: 'extra-b' },
      { id: '33333333-1111-4111-8111-111111111111', slug: 'extra-c' },
    ];
    state.pages = [homeRow(), aboutRow(), ...extraPages.map(({ id, slug }) =>
      row(id, {
        Title: titleProp(slug),
        Slug: textProp(slug),
        Type: { select: { name: 'markdown' } },
      })
    )];
    const seed = await runEngine(seedEnv);
    expect(seed.exitCode).toBe(0);
    for (const { slug } of extraPages) {
      expect(existsSync(path.join(ratioSite, '_pages', `${slug}.md`))).toBe(true);
    }

    state.pages = [aboutRow()]; // only 1 of 4 tracked pages still published
    const ratioOutFile = makeOutputFile();
    const result = await runEngine({ ...seedEnv, GITHUB_OUTPUT: ratioOutFile });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('HELD BACK');
    expect(result.stderr).toContain('75%');
    for (const { slug } of extraPages) {
      expect(existsSync(path.join(ratioSite, '_pages', `${slug}.md`))).toBe(true); // untouched
    }

    const outputs = parseGithubOutput(readFileSync(ratioOutFile, 'utf8'));
    expect(outputs.changed).toBe('false');
    const summary = JSON.parse(outputs.summary);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('bulk_delete_guard');
    expect(summary.detail).toContain('75%');
    expect(summary.detail).not.toContain('extra-a'); // no filenames — counts only
    expect(readRunSummaryArtifact(seedEnv.RUN_SUMMARY_FILE, 'bulk_delete_guard')).toEqual(summary);

    state.pages = [homeRow(), aboutRow()]; // restore shared fixture state
  });

  it('a Notion API failure aborts the run and reports code=sync_error with the database ID redacted', async () => {
    const failSite = makeSite();
    const failOutFile = makeOutputFile();
    const failStepSummaryFile = makeOutputFile();

    const failEnv = {
      ...baseEnv(failSite, { NOTION_PAGES_DATABASE_ID: FAILING_DB, NOTION_POSTS_DATABASE_ID: '' }),
      GITHUB_OUTPUT: failOutFile,
      GITHUB_STEP_SUMMARY: failStepSummaryFile,
    };
    const result = await runEngine(failEnv);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Fatal');
    // The query fails before any page is written — _pages/ may exist (it's
    // created up front) but stays empty.
    expect(existsSync(path.join(failSite, '_pages', 'about.md'))).toBe(false);

    const outputs = parseGithubOutput(readFileSync(failOutFile, 'utf8'));
    expect(outputs.changed).toBe('false');
    const summary = JSON.parse(outputs.summary);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('sync_error');
    expect(summary.pages).toBeNull();
    expect(summary.detail).toContain('[redacted]');
    expect(summary.detail).not.toContain(FAILING_DB);

    const stepSummaryText = readFileSync(failStepSummaryFile, 'utf8');
    expect(stepSummaryText).not.toContain(FAILING_DB);
    expect(stepSummaryText).toContain('[redacted]');

    // exit 1, yet the artifact round-trips: it was written before process.exit.
    expect(readRunSummaryArtifact(failEnv.RUN_SUMMARY_FILE, 'sync_error')).toEqual(summary);
  });

  it('a single failing row reports code=row_errors, names the row, and exits 0 so the rest of the sync is committed', async () => {
    const rowErrorSite = makeSite();

    const erroringRow = row(ERRORING_PAGE_ID, {
      Title: titleProp('Erroring'),
      Slug: textProp('erroring'),
      Type: { select: { name: 'markdown' } },
    });
    state.pages = [homeRow(), aboutRow(), erroringRow];

    const { result, outputs, summaryFile } = await outputsOf(baseEnv(rowErrorSite), makeOutputFile());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('::warning::');
    expect(outputs.changed).toBe('true');
    const summary = readRunSummaryArtifact(summaryFile, 'row_errors');
    expect(summary.result).toBe('failure');
    expect(summary.changed).toBe(true);
    expect(summary.pages.errors).toBe(1);
    expect(summary.pages.created).toBe(1); // about.md landed before the failing row
    expect(summary.posts).not.toBeNull(); // the posts section still ran to completion
    expect(existsSync(path.join(rowErrorSite, '_pages', 'about.md'))).toBe(true);
    expect(existsSync(path.join(rowErrorSite, '_pages', 'erroring.md'))).toBe(false);
    // detail carries counts only — never the failed row's id or error text.
    expect(outputs.summary).not.toContain(ERRORING_PAGE_ID);
    expect(summary.detail).not.toContain('Erroring');
    expect(summary.affected).toEqual([
      { section: 'pages', title: 'Erroring', reason_code: 'read_failed', reason: expect.any(String) },
    ]);
    expect(summary).toEqual(JSON.parse(outputs.summary));

    state.pages = [homeRow(), aboutRow()]; // restore shared fixture state
  });

  it('allow_bulk_delete=true (any case) pushes the deletion through', async () => {
    state.pages = []; // same mass unpublish as the previous scenario

    const { result, outputs, summaryFile } = await outputsOf(
      { ...env, ALLOW_BULK_DELETE: 'True' },
      makeOutputFile()
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(site, '_pages', 'about-renamed.md'))).toBe(false);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('1 deleted');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('honors the legacy posts-only fallback (NOTION_DATABASE_ID)', async () => {
    const legacySite = makeSite();
    const legacyOut  = makeOutputFile();

    const { result, outputs, summaryFile } = await outputsOf(
      baseEnv(legacySite, {
        NOTION_PAGES_DATABASE_ID: '',
        NOTION_POSTS_DATABASE_ID: '',
        NOTION_DATABASE_ID: LEGACY_POSTS_DB,
      }),
      legacyOut
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Skipping pages sync');
    expect(existsSync(path.join(legacySite, '_posts', '2026-01-15-hello-world.md'))).toBe(true);
    expect(existsSync(path.join(legacySite, '_pages'))).toBe(false);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('posts: 1 created');
    expect(outputs.summary).not.toContain('pages:');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('follows Notion pagination (has_more/next_cursor) across multiple pages of both database rows and block children', async () => {
    // The fake server answers one row/block per response (PAGE_SIZE = 1
    // above), so this scenario only comes out complete if fetchPublished and
    // fetchAllBlocks correctly follow start_cursor across several pages
    // rather than trusting the first response.
    const pagSite = makeSite();
    const pagOut  = makeOutputFile();

    state.pages = [aboutRow(), paginatedRow()]; // 2 published rows → 2 query pages
    state.blocks[PAGINATED_ID] = [
      paragraph('Block one.'),
      paragraph('Block two.'),
      paragraph('Block three.'),
    ]; // 3 blocks → 3 block-children pages

    const { result, outputs, summaryFile } = await outputsOf(baseEnv(pagSite), pagOut);
    expect(result.exitCode).toBe(0);

    expect(existsSync(path.join(pagSite, '_pages', 'about.md'))).toBe(true);
    const paginated = readFileSync(path.join(pagSite, '_pages', 'paginated.md'), 'utf8');
    expect(paginated).toContain('Block one.\n\nBlock two.\n\nBlock three.');

    expect(outputs.summary).toContain('pages: 2 created');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));

    state.pages = [homeRow(), aboutRow()]; // restore shared fixture state
    delete state.blocks[PAGINATED_ID];
  });

  it('runs the engine the way local development always has (no GITHUB_OUTPUT)', async () => {
    resetFixtures();
    const localSite = makeSite();

    const localEnv = baseEnv(localSite);
    const result = await runEngine(localEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Sync complete.');
    expect(result.stdout).toContain('changed: true');
    expect(existsSync(path.join(localSite, '_pages', 'about.md'))).toBe(true);
    readRunSummaryArtifact(localEnv.RUN_SUMMARY_FILE, 'synced');
  });
});

// ─── Owner mistakes and everyday Notion use (v2.1.0) ──────────────────────────
//
// Each scenario builds its own site, so they can be read on their own. The
// fixtures use the v2 template's column names unless a test says otherwise.

describe('everyday Notion use never freezes the site', () => {
  const v2Title  = (...parts) => ({ type: 'title', title: parts.map((plain_text) => ({ plain_text, annotations: {} })) });
  const v2Text   = (t) => ({ type: 'rich_text', rich_text: t ? [{ plain_text: t }] : [] });
  const block    = (id, type, data, extra = {}) => ({ id, object: 'block', type, [type]: data, has_children: false, ...extra });
  const textBlock = (id, t) => block(id, 'paragraph', { rich_text: [{ plain_text: t, annotations: {}, href: null }] });
  const fileUrl  = (key) => `http://127.0.0.1:${server.port}/files/${key}?X-Amz-Signature=${Math.random().toString(16).slice(2)}`;

  const SAMPLE_ID  = 'a1a1a1a1-0000-4000-8000-000000000001';
  const OWN_ID     = 'a1a1a1a1-0000-4000-8000-000000000002';
  const V2_HOME_ID = 'b2b2b2b2-0000-4000-8000-000000000001';
  const V2_PAGE_ID = 'b2b2b2b2-0000-4000-8000-000000000002';
  const PHOTO_POST = 'c3c3c3c3-0000-4000-8000-000000000001';
  const TOGGLE_ID  = 'c3c3c3c3-0000-4000-8000-0000000000aa';

  const v2Post = (id, title, { slug = '', date = '2026-01-20', extra = {} } = {}) => row(id, {
    Title: v2Title(title),
    Status: { type: 'select', select: { name: 'Published' } },
    'Web address': v2Text(slug),
    Date: { type: 'date', date: date ? { start: date } : null },
    Tags: { type: 'multi_select', multi_select: [] },
    ...extra,
  });

  // Pages-only and posts-only runs keep each scenario to the section it is about.
  const postsOnly = (site, overrides = {}) => baseEnv(site, { NOTION_PAGES_DATABASE_ID: '', ...overrides });

  afterAll(() => {
    resetFixtures();
    state.files = {};
  });

  it('removing the example post goes through, even though it leaves no published posts', async () => {
    const site = makeSite();
    state.posts = [v2Post(SAMPLE_ID, 'Welcome to your new website', { slug: 'welcome-to-inkdrafts' })];
    state.blocks[SAMPLE_ID] = [textBlock('d0000000-0000-4000-8000-000000000001', 'Sample body.')];
    expect((await runEngine(postsOnly(site))).exitCode).toBe(0);
    const samplePath = path.join(site, '_posts', '2026-01-20-welcome-to-inkdrafts.md');
    expect(existsSync(samplePath)).toBe(true);

    state.posts = [];
    const { result, outputs, summaryFile } = await outputsOf(postsOnly(site), makeOutputFile());
    expect(result.exitCode).toBe(0);
    expect(existsSync(samplePath)).toBe(false);
    expect(outputs.changed).toBe('true');
    expect(readRunSummaryArtifact(summaryFile, 'synced').posts.deleted).toBe(1);
  });

  it('a guard in one section still lets the other section publish', async () => {
    const site = makeSite();
    state.pages = [homeRow(), aboutRow()];
    state.posts = [];
    expect((await runEngine(baseEnv(site))).exitCode).toBe(0);

    // Pages misread (zero rows), while a new post is written the same run.
    state.pages = [];
    state.posts = [v2Post(OWN_ID, 'A new post')];
    state.blocks[OWN_ID] = [textBlock('d0000000-0000-4000-8000-000000000002', 'New words.')];
    const { result, outputs, summaryFile } = await outputsOf(baseEnv(site), makeOutputFile());

    expect(result.exitCode).toBe(1);
    expect(existsSync(path.join(site, '_pages', 'about.md'))).toBe(true);
    expect(existsSync(path.join(site, '_posts', '2026-01-20-a-new-post.md'))).toBe(true);
    // changed=true is what lets the workflow commit the new post.
    expect(outputs.changed).toBe('true');
    const summary = readRunSummaryArtifact(summaryFile, 'bulk_delete_guard');
    expect(summary.posts.created).toBe(1);
    expect(summary.affected.map((r) => r.title)).toEqual(['About']);
    resetFixtures();
  });

  it('two rows with the same web address: the first is published, the second is named in the summary', async () => {
    const site = makeSite();
    const second = 'a1a1a1a1-0000-4000-8000-000000000003';
    state.posts = [
      v2Post(OWN_ID, 'Mi viaje', { slug: 'mi-viaje' }),
      v2Post(second, 'Mi viaje: día 1', { slug: 'mi-viaje' }),
    ];
    state.blocks[OWN_ID] = [textBlock('d0000000-0000-4000-8000-000000000002', 'One.')];
    state.blocks[second] = [textBlock('d0000000-0000-4000-8000-000000000003', 'Two.')];

    const { result, summaryFile } = await outputsOf(postsOnly(site), makeOutputFile());
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(site, '_posts', '2026-01-20-mi-viaje.md'), 'utf8')).toContain('One.');
    const summary = readRunSummaryArtifact(summaryFile, 'row_errors');
    expect(summary.affected).toEqual([
      { section: 'posts', title: 'Mi viaje: día 1', reason_code: 'duplicate_web_address', reason: expect.any(String) },
    ]);
  });

  it('an accented web address with a colon, and a formatted title, come out as valid front matter', async () => {
    const site = makeSite();
    state.posts = [row(OWN_ID, {
      Title: v2Title('Mi ', 'gran', ' viaje: "día" 1'),
      Status: { select: { name: 'Published' } },
      'Web address': v2Text('Mi viaje: día 1'),
      Date: { date: { start: '2026-01-20' } },
    })];
    state.blocks[OWN_ID] = [textBlock('d0000000-0000-4000-8000-000000000002', 'Body.')];

    expect((await runEngine(postsOnly(site))).exitCode).toBe(0);
    const text = readFileSync(path.join(site, '_posts', '2026-01-20-mi-viaje-dia-1.md'), 'utf8');
    const front = yaml.load(text.split('---')[1]);
    expect(front.title).toBe('Mi gran viaje: "día" 1');
    expect(front.slug).toBe('mi-viaje-dia-1');
  });

  it('fixing a typo in a title keeps the post at the same web address', async () => {
    const site = makeSite();
    state.posts = [v2Post(OWN_ID, 'My tirp to Lisbon')];
    state.blocks[OWN_ID] = [textBlock('d0000000-0000-4000-8000-000000000002', 'Body.')];
    expect((await runEngine(postsOnly(site))).exitCode).toBe(0);

    state.posts = [v2Post(OWN_ID, 'My trip to Lisbon')];
    expect((await runEngine(postsOnly(site))).exitCode).toBe(0);
    const file = path.join(site, '_posts', '2026-01-20-my-tirp-to-lisbon.md');
    expect(readFileSync(file, 'utf8')).toContain('title: "My trip to Lisbon"');
  });

  it('a photo dragged into Notion is copied into the site once, and a fresh signature is not a change', async () => {
    const site = makeSite();
    state.files = {
      'ws/f1/Beach Day.JPG': { body: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), type: 'image/jpeg' },
      'ws/f2/cover.png':     { body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' },
    };
    state.fileFetches = [];
    const photoBlock = () => block('e0000000-0000-4000-8000-000000000001', 'image', {
      type: 'file', file: { url: fileUrl('ws/f1/Beach%20Day.JPG') }, caption: [{ plain_text: 'The beach' }],
    });
    const photoPost = () => v2Post(PHOTO_POST, 'Summer', {
      extra: { 'Cover image': { type: 'files', files: [{ name: 'cover.png', type: 'file', file: { url: fileUrl('ws/f2/cover.png') } }] } },
    });
    state.posts = [photoPost()];
    state.blocks[PHOTO_POST] = [photoBlock()];

    let run = await outputsOf(postsOnly(site), makeOutputFile());
    expect(run.result.exitCode).toBe(0);
    const post = readFileSync(path.join(site, '_posts', '2026-01-20-summer.md'), 'utf8');
    const photo = post.match(/!\[The beach\]\((\/assets\/notion\/[^)]+)\)/)?.[1];
    expect(photo).toMatch(/^\/assets\/notion\/[0-9a-f]{12}-beach-day\.jpg$/);
    expect(post).not.toContain('X-Amz-Signature');
    const cover = post.match(/^cover_image: "([^"]+)"/m)?.[1];
    expect(cover).toMatch(/^\/assets\/notion\/[0-9a-f]{12}-cover\.png$/);
    expect(readFileSync(path.join(site, photo))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
    expect(state.fileFetches.length).toBe(2);

    // Next run: Notion signs both URLs again. Nothing to download or commit.
    state.posts = [photoPost()];
    state.blocks[PHOTO_POST] = [photoBlock()];
    run = await outputsOf(postsOnly(site), makeOutputFile());
    expect(run.result.exitCode).toBe(0);
    expect(run.outputs.changed).toBe('false');
    expect(state.fileFetches.length).toBe(2);

    // The photo is removed from the post: its copy goes too, the cover stays.
    state.blocks[PHOTO_POST] = [textBlock('d0000000-0000-4000-8000-000000000009', 'No photo now.')];
    run = await outputsOf(postsOnly(site), makeOutputFile());
    expect(run.outputs.changed).toBe('true');
    expect(existsSync(path.join(site, photo))).toBe(false);
    expect(existsSync(path.join(site, cover))).toBe(true);
  });

  it('a photo over the size cap, or from a host that is not Notion, is left out and named — the post still publishes', async () => {
    const site = makeSite();
    state.files = { 'ws/big/huge.jpg': { body: new Uint8Array(21 * 1024 * 1024), type: 'image/jpeg' } };
    state.posts = [v2Post(PHOTO_POST, 'Big photo day')];
    state.blocks[PHOTO_POST] = [
      textBlock('d0000000-0000-4000-8000-000000000001', 'Words stay.'),
      block('e0000000-0000-4000-8000-000000000002', 'image', { type: 'file', file: { url: fileUrl('ws/big/huge.jpg') }, caption: [] }),
      block('e0000000-0000-4000-8000-000000000003', 'image', { type: 'file', file: { url: 'https://attacker.example/x.jpg' }, caption: [] }),
    ];

    const { result, summaryFile } = await outputsOf(postsOnly(site), makeOutputFile());
    expect(result.exitCode).toBe(0);
    const post = readFileSync(path.join(site, '_posts', '2026-01-20-big-photo-day.md'), 'utf8');
    expect(post).toContain('Words stay.');
    expect(post).not.toContain('![');
    expect(existsSync(path.join(site, 'assets', 'notion'))).toBe(false);
    const summary = readRunSummaryArtifact(summaryFile, 'synced');
    expect(summary.skipped.map((r) => [r.title, r.reason_code])).toEqual([
      ['Big photo day', 'file_too_large'],
      ['Big photo day', 'file_unavailable'],
    ]);
    state.files = {};
  });

  it('toggles and nested lists publish with their contents; unsupported or unreadable blocks are counted, not fatal', async () => {
    const site = makeSite();
    state.posts = [v2Post(OWN_ID, 'Nested')];
    state.blocks[OWN_ID] = [
      block(TOGGLE_ID, 'toggle', { rich_text: [{ plain_text: 'Opening hours', annotations: {} }] }, { has_children: true }),
      block('e0000000-0000-4000-8000-000000000010', 'child_database', { title: 'Linked list' }),
      // A synced copy whose original lives on a page the connection can't read.
      block('e0000000-0000-4000-8000-000000000012', 'synced_block', { synced_from: { block_id: ERRORING_PAGE_ID } }),
    ];
    state.blocks[TOGGLE_ID] = [
      block('e0000000-0000-4000-8000-000000000011', 'bulleted_list_item', { rich_text: [{ plain_text: 'Mon to Fri', annotations: {} }] }),
    ];

    const { result, summaryFile } = await outputsOf(postsOnly(site), makeOutputFile());
    expect(result.exitCode).toBe(0);
    const post = readFileSync(path.join(site, '_posts', '2026-01-20-nested.md'), 'utf8');
    expect(post).toContain('<details markdown="1">\n<summary>Opening hours</summary>\n\n- Mon to Fri\n\n</details>');
    const summary = readRunSummaryArtifact(summaryFile, 'synced');
    expect(summary.posts.skipped_blocks).toBe(2);
    expect(summary.skipped).toEqual([
      { section: 'posts', title: 'Nested', reason_code: 'blocks_unsupported', reason: expect.any(String), count: 2 },
    ]);
  });

  it('a post dated in the future waits, and is neither deleted nor counted toward the guard', async () => {
    const site = makeSite();
    state.posts = [v2Post(OWN_ID, 'Already live')];
    state.blocks[OWN_ID] = [textBlock('d0000000-0000-4000-8000-000000000002', 'Live.')];
    expect((await runEngine(postsOnly(site))).exitCode).toBe(0);
    const live = path.join(site, '_posts', '2026-01-20-already-live.md');

    // The only post moves to next year, and a new one is scheduled.
    const later = `${new Date().getUTCFullYear() + 1}-06-01`;
    const next = 'a1a1a1a1-0000-4000-8000-000000000004';
    state.posts = [v2Post(OWN_ID, 'Already live', { date: later }), v2Post(next, 'Coming soon', { date: later })];
    const { result, summaryFile } = await outputsOf(postsOnly(site), makeOutputFile());
    expect(result.exitCode).toBe(0);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(path.join(site, '_posts', `${later}-coming-soon.md`))).toBe(false);
    expect(readRunSummaryArtifact(summaryFile, 'synced').posts.scheduled).toBe(2);
  });

  it('Liquid-looking text in a post cannot break the site build', async () => {
    const site = makeSite();
    state.posts = [v2Post(OWN_ID, 'Templates')];
    state.blocks[OWN_ID] = [textBlock('d0000000-0000-4000-8000-000000000002', 'Write {{ name }} and {% if %} literally.')];
    expect((await runEngine(postsOnly(site))).exitCode).toBe(0);
    const body = readFileSync(path.join(site, '_posts', '2026-01-20-templates.md'), 'utf8');
    expect(body).toContain('{% raw %}\nWrite {{ name }} and {% if %} literally.\n{% endraw %}');
  });

  it('a v2 template copy (friendly names, uploaded profile photo) syncs end to end', async () => {
    const site = makeSite();
    state.files = { 'ws/me/me.webp': { body: new Uint8Array([1, 2, 3, 4]), type: 'image/webp' } };
    state.pages = [
      row(V2_HOME_ID, {
        Title: v2Title('Home'),
        Status: { select: { name: 'Published' } },
        Type: { select: { name: 'Home page' } },
        'Show in menu': { checkbox: false },
        'Menu order': { number: 0 },
        Name: v2Text('Ana Silva'),
        Tagline: v2Text('Potter in Porto'),
        Photo: { type: 'files', files: [{ name: 'me.webp', type: 'file', file: { url: fileUrl('ws/me/me.webp') } }] },
        Links: v2Text('Email: mailto:ana@example.com'),
      }),
      row(V2_PAGE_ID, {
        Title: v2Title('Writing'),
        Status: { select: { name: 'Published' } },
        Type: { select: { name: 'List of posts' } },
        'Show in menu': { checkbox: true },
        'Menu order': { number: 20 },
        'Web address': v2Text('blog'),
      }),
    ];
    state.blocks[V2_HOME_ID] = [textBlock('d0000000-0000-4000-8000-000000000005', 'I make bowls.')];
    state.blocks[V2_PAGE_ID] = [];

    const env = baseEnv(site, { NOTION_POSTS_DATABASE_ID: '' });
    expect((await runEngine(env)).exitCode).toBe(0);
    const home = yaml.load(readFileSync(path.join(site, '_data', 'home.yml'), 'utf8'));
    expect(home.name).toBe('Ana Silva');
    expect(home.profile_picture).toMatch(/^\/assets\/notion\/[0-9a-f]{12}-me\.webp$/);
    expect(home.bio).toContain('I make bowls.');
    expect(readFileSync(path.join(site, '_pages', 'blog.md'), 'utf8')).toContain('layout: blog');
    expect(yaml.load(readFileSync(path.join(site, '_data', 'nav.yml'), 'utf8'))).toEqual([{ title: 'Writing', url: '/blog' }]);
    const config = readFileSync(path.join(site, '_config.yml'), 'utf8');
    expect(config).toContain('title: "Ana Silva"');
    state.files = {};
    resetFixtures();
  });

  it('the home Tagline becomes the site description; a project site links copies under its baseurl', async () => {
    const site = makeSite();
    writeFileSync(path.join(site, '_config.yml'),
      'title: "My website"\ndescription: "A Notion-powered Jekyll site."\nbaseurl: "/my-site"\nauthor:\n  name: ""\n');
    state.files = { 'ws/me/me.png': { body: new Uint8Array([1]), type: 'image/png' } };
    state.pages = [row(V2_HOME_ID, {
      Title: v2Title('Home'),
      Type: { select: { name: 'home' } },
      Name: v2Text('Kofi'),
      Tagline: v2Text('Photos from Accra'),
      Photo: { type: 'files', files: [{ name: 'me.png', type: 'file', file: { url: fileUrl('ws/me/me.png') } }] },
    })];
    state.blocks[V2_HOME_ID] = [];

    expect((await runEngine(baseEnv(site, { NOTION_POSTS_DATABASE_ID: '' }))).exitCode).toBe(0);
    const config = readFileSync(path.join(site, '_config.yml'), 'utf8');
    expect(config).toContain('description: "Photos from Accra"');
    expect(yaml.load(readFileSync(path.join(site, '_data', 'home.yml'), 'utf8')).profile_picture)
      .toMatch(/^\/my-site\/assets\/notion\//);
    state.files = {};
    resetFixtures();
  });
});
