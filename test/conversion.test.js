/**
 * Deterministic unit tests for the pure Notion → Jekyll conversion logic:
 * rich text annotations, block-to-Markdown mapping (including list grouping),
 * slugging, and front-matter/filename building.
 *
 * Every function here takes plain data in and returns a value — no Notion
 * client, no filesystem, no network. The full pipeline (pagination included)
 * is exercised end-to-end by test/harness.test.js against a local fake API.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../scripts/sync-notion.js');

// ─── richTextToMarkdown ────────────────────────────────────────────────────────

describe('richTextToMarkdown', () => {
  const item = (plain_text, annotations = {}, href = null) => ({ plain_text, annotations, href });

  it('returns an empty string for an empty array', () => {
    expect(engine.richTextToMarkdown([])).toBe('');
  });

  it('defaults to an empty array when called with no argument', () => {
    expect(engine.richTextToMarkdown()).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(engine.richTextToMarkdown([item('hello world')])).toBe('hello world');
  });

  it('skips items with empty plain_text without adding stray annotations', () => {
    expect(engine.richTextToMarkdown([item(''), item('kept')])).toBe('kept');
  });

  it.each([
    ['bold', { bold: true }, '**x**'],
    ['italic', { italic: true }, '*x*'],
    ['bold + italic (combined, not nested doubling)', { bold: true, italic: true }, '***x***'],
    ['strikethrough', { strikethrough: true }, '~~x~~'],
    ['code', { code: true }, '`x`'],
  ])('applies %s annotation', (_name, annotations, expected) => {
    expect(engine.richTextToMarkdown([item('x', annotations)])).toBe(expected);
  });

  it('wraps in a link when href is set, around any annotations already applied', () => {
    expect(engine.richTextToMarkdown([item('x', { bold: true }, 'https://example.com')]))
      .toBe('[**x**](https://example.com)');
  });

  it('stacks bold+italic, strikethrough and a link in application order: emphasis, then strikethrough, then the link wraps everything', () => {
    expect(engine.richTextToMarkdown([
      item('x', { bold: true, italic: true, strikethrough: true }, 'https://example.com'),
    ])).toBe('[~~***x***~~](https://example.com)');
  });

  it('joins multiple rich text items with no separator, each independently annotated', () => {
    expect(engine.richTextToMarkdown([
      item('plain '),
      item('bold', { bold: true }),
      item(' and '),
      item('linked', {}, 'https://example.com'),
    ])).toBe('plain **bold** and [linked](https://example.com)');
  });
});

// ─── blockToMarkdown ───────────────────────────────────────────────────────────

const rt = (text, annotations = {}, href = null) => [{ plain_text: text, annotations, href }];

describe('blockToMarkdown', () => {
  it('returns null when the block has no data for its declared type', () => {
    expect(engine.blockToMarkdown({ type: 'paragraph' })).toBeNull();
  });

  it('returns null for an unrecognized block type', () => {
    expect(engine.blockToMarkdown({ type: 'unsupported_future_block', unsupported_future_block: {} }))
      .toBeNull();
  });

  it.each([
    ['child_page', { child_page: { title: 'x' } }],
    ['child_database', { child_database: { title: 'x' } }],
  ])('returns null for %s (not representable as page content)', (type, extra) => {
    expect(engine.blockToMarkdown({ type, ...extra })).toBeNull();
  });

  it('renders table_of_contents as an empty string (dropped, not skipped-with-gap)', () => {
    expect(engine.blockToMarkdown({ type: 'table_of_contents', table_of_contents: {} })).toBe('');
  });

  it('paragraph renders bare rich text', () => {
    expect(engine.blockToMarkdown({ type: 'paragraph', paragraph: { rich_text: rt('hello') } }))
      .toBe('hello');
  });

  it.each([
    ['heading_1', '#'],
    ['heading_2', '##'],
    ['heading_3', '###'],
  ])('%s prefixes with %s', (type, prefix) => {
    expect(engine.blockToMarkdown({ type, [type]: { rich_text: rt('Title') } }))
      .toBe(`${prefix} Title`);
  });

  it('bulleted_list_item renders a dash item', () => {
    expect(engine.blockToMarkdown({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('a') } }))
      .toBe('- a');
  });

  it('numbered_list_item always renders as "1." (Jekyll/Markdown renumbers on output)', () => {
    expect(engine.blockToMarkdown({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt('a') } }))
      .toBe('1. a');
  });

  it.each([
    [true, '- [x] done'],
    [false, '- [ ] not done'],
  ])('to_do checked=%s renders a GFM task item', (checked, expected) => {
    expect(engine.blockToMarkdown({
      type: 'to_do',
      to_do: { checked, rich_text: rt(checked ? 'done' : 'not done') },
    })).toBe(expected);
  });

  it('code fences the raw text (not rich-text-annotated) with the language tag', () => {
    expect(engine.blockToMarkdown({
      type: 'code',
      code: { language: 'javascript', rich_text: rt('const x = 1;') },
    })).toBe('```javascript\nconst x = 1;\n```');
  });

  it('code omits the language tag for "plain text"', () => {
    expect(engine.blockToMarkdown({
      type: 'code',
      code: { language: 'plain text', rich_text: rt('hi') },
    })).toBe('```\nhi\n```');
  });

  it('code appends an italicized caption line when present', () => {
    expect(engine.blockToMarkdown({
      type: 'code',
      code: { language: 'bash', rich_text: rt('echo hi'), caption: rt('a caption') },
    })).toBe('```bash\necho hi\n```\n*a caption*');
  });

  it('quote prefixes with >', () => {
    expect(engine.blockToMarkdown({ type: 'quote', quote: { rich_text: rt('quoted') } }))
      .toBe('> quoted');
  });

  it('callout prefixes with > and an emoji icon when present', () => {
    expect(engine.blockToMarkdown({
      type: 'callout',
      callout: { icon: { emoji: '💡' }, rich_text: rt('tip') },
    })).toBe('> 💡 tip');
  });

  it('callout without an icon omits the emoji prefix', () => {
    expect(engine.blockToMarkdown({ type: 'callout', callout: { rich_text: rt('tip') } }))
      .toBe('> tip');
  });

  it('divider renders a bare rule', () => {
    expect(engine.blockToMarkdown({ type: 'divider', divider: {} })).toBe('---');
  });

  it('image links an external url as-is, and a Notion-hosted file only through its local copy', () => {
    expect(engine.blockToMarkdown({
      type: 'image',
      image: { type: 'external', external: { url: 'https://example.com/a.png' }, caption: rt('alt text') },
    })).toBe('![alt text](https://example.com/a.png)');

    expect(engine.blockToMarkdown({
      type: 'image',
      _local_url: '/assets/notion/abc-b.png',
      image: { type: 'file', file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/b.png?X-Amz-Expires=3600' } },
    })).toBe('![](/assets/notion/abc-b.png)');

    // Never the signed URL: it expires within the hour and changes on every read.
    expect(engine.blockToMarkdown({
      type: 'image',
      image: { type: 'file', file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/b.png?X-Amz-Expires=3600' } },
    })).toBeNull();
  });

  it.each(['file', 'pdf', 'audio'])('%s renders a download link to its copy, named by caption or file name', (type) => {
    expect(engine.blockToMarkdown({
      type, _local_url: '/assets/notion/x-menu.pdf',
      [type]: { type: 'file', file: { url: 'https://file.notion.so/f/menu.pdf' }, name: 'menu.pdf', caption: [] },
    })).toBe('[menu.pdf](/assets/notion/x-menu.pdf)');
    expect(engine.blockToMarkdown({
      type, [type]: { type: 'external', external: { url: 'https://example.com/a.pdf' }, caption: rt('Our menu') },
    })).toBe('[Our menu](https://example.com/a.pdf)');
  });

  it('embed renders as a link', () => {
    expect(engine.blockToMarkdown({ type: 'embed', embed: { url: 'https://maps.example.com/x' } }))
      .toBe('[https://maps.example.com/x](https://maps.example.com/x)');
  });

  it('video renders a play-arrow link, with or without a caption', () => {
    expect(engine.blockToMarkdown({
      type: 'video',
      video: { type: 'external', external: { url: 'https://example.com/v.mp4' }, caption: rt('demo') },
    })).toBe('[▶ demo](https://example.com/v.mp4)');

    expect(engine.blockToMarkdown({
      type: 'video',
      video: { type: 'external', external: { url: 'https://example.com/v.mp4' } },
    })).toBe('[▶ Watch video](https://example.com/v.mp4)');
  });

  it.each(['bookmark', 'link_preview'])('%s renders the url as its own link text', (type) => {
    expect(engine.blockToMarkdown({ type, [type]: { url: 'https://example.com' } }))
      .toBe('[https://example.com](https://example.com)');
  });

  it('toggle renders a collapsed <details> that kramdown fills with the toggle body', () => {
    expect(engine.blockToMarkdown({ type: 'toggle', toggle: { rich_text: rt('More') } }))
      .toBe('<details markdown="1">\n<summary>More</summary>\n\n</details>');
    expect(engine.blockToMarkdown({
      type: 'toggle',
      toggle: { rich_text: rt('Q: <why>?') },
      children: [{ type: 'paragraph', paragraph: { rich_text: rt('Because.') } }],
    })).toBe('<details markdown="1">\n<summary>Q: &lt;why&gt;?</summary>\n\nBecause.\n\n</details>');
  });

  it('nests child list items under their parent, indented to its content column', () => {
    const child = { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('child') } };
    expect(engine.blockToMarkdown({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('parent') }, children: [child] }))
      .toBe('- parent\n  - child');
    expect(engine.blockToMarkdown({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt('one') }, children: [child] }))
      .toBe('1. one\n   - child');
  });

  it('keeps a quote\'s nested blocks inside the quote', () => {
    expect(engine.blockToMarkdown({
      type: 'quote', quote: { rich_text: rt('said') },
      children: [{ type: 'paragraph', paragraph: { rich_text: rt('more') } }],
    })).toBe('> said\n>\n> more');
  });

  it('flattens columns into one column of content, in reading order', () => {
    const col = (text) => ({ type: 'column', column: {}, children: [{ type: 'paragraph', paragraph: { rich_text: rt(text) } }] });
    expect(engine.blockToMarkdown({ type: 'column_list', column_list: {}, children: [col('left'), col('right')] }))
      .toBe('left\n\nright');
  });

  it('renders a table as a GFM table, with a header rule only when Notion marks a header row', () => {
    const row = (...cells) => ({ type: 'table_row', table_row: { cells: cells.map((c) => rt(c)) } });
    expect(engine.blockToMarkdown({
      type: 'table', table: { has_column_header: true }, children: [row('Day', 'Time'), row('Mon', '9|10')],
    })).toBe('| Day | Time |\n| --- | --- |\n| Mon | 9\\|10 |');
    expect(engine.blockToMarkdown({ type: 'table', table: { has_column_header: false }, children: [row('a', 'b')] }))
      .toBe('| a | b |');
  });
});

// ─── blocksToMarkdown: list grouping ────────────────────────────────────────────

describe('blocksToMarkdown (list grouping and blank-line separation)', () => {
  const para = (t) => ({ type: 'paragraph', paragraph: { rich_text: rt(t) } });
  const bullet = (t) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(t) } });
  const numbered = (t) => ({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt(t) } });
  const todo = (t) => ({ type: 'to_do', to_do: { checked: false, rich_text: rt(t) } });
  const heading = (t) => ({ type: 'heading_2', heading_2: { rich_text: rt(t) } });

  it('returns an empty string for no blocks', () => {
    expect(engine.blocksToMarkdown([])).toBe('');
  });

  it('separates ordinary blocks with a blank line', () => {
    expect(engine.blocksToMarkdown([para('one'), para('two')])).toBe('one\n\ntwo');
  });

  it('keeps consecutive bulleted list items adjacent, with no blank line between them', () => {
    expect(engine.blocksToMarkdown([bullet('a'), bullet('b'), bullet('c')]))
      .toBe('- a\n- b\n- c');
  });

  it('keeps consecutive numbered list items adjacent', () => {
    expect(engine.blocksToMarkdown([numbered('a'), numbered('b')]))
      .toBe('1. a\n1. b');
  });

  it('groups across differing list types too — grouping keys off "is this any list item", not the specific type', () => {
    expect(engine.blocksToMarkdown([bullet('a'), numbered('b')]))
      .toBe('- a\n1. b');
  });

  it('groups to_do items as a list type too', () => {
    expect(engine.blocksToMarkdown([todo('a'), todo('b')]))
      .toBe('- [ ] a\n- [ ] b');
  });

  it('separates a list from surrounding paragraphs with blank lines on both sides', () => {
    expect(engine.blocksToMarkdown([para('intro'), bullet('a'), bullet('b'), para('outro')]))
      .toBe('intro\n\n- a\n- b\n\noutro');
  });

  it('mixes headings and paragraphs with blank-line separation throughout', () => {
    expect(engine.blocksToMarkdown([heading('Section'), para('body')]))
      .toBe('## Section\n\nbody');
  });

  it('drops blocks that render to null without leaving a stray blank line', () => {
    const unsupported = { type: 'child_database', child_database: { title: 'x' } };
    expect(engine.blocksToMarkdown([para('before'), unsupported, para('after')]))
      .toBe('before\n\nafter');
  });

  it('drops a leading null block entirely (no leading blank line)', () => {
    const unsupported = { type: 'child_page', child_page: { title: 'x' } };
    expect(engine.blocksToMarkdown([unsupported, para('only')])).toBe('only');
  });

  it('a mid-document block that maps to "" (table_of_contents) still consumes a separator slot, doubling the blank line', () => {
    // Documents current behavior, not necessarily ideal: unlike a null-returning
    // block (skipped via `continue` before the separator logic runs), an
    // empty-string block still reaches the "push a blank separator" branch —
    // it just contributes no content of its own.
    expect(engine.blocksToMarkdown([
      para('before'),
      { type: 'table_of_contents', table_of_contents: {} },
      para('after'),
    ])).toBe('before\n\n\nafter');
  });

  it('trims a trailing "" block (table_of_contents) off the assembled body instead of leaving a dangling blank line', () => {
    expect(engine.blocksToMarkdown([
      para('content'),
      { type: 'table_of_contents', table_of_contents: {} },
    ])).toBe('content');
  });

  it('trims a leading "" block (table_of_contents) off the assembled body', () => {
    expect(engine.blocksToMarkdown([
      { type: 'table_of_contents', table_of_contents: {} },
      para('content'),
    ])).toBe('content');
  });
});

// ─── titleToSlug ────────────────────────────────────────────────────────────────

describe('titleToSlug', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['  Leading and trailing spaces  ', 'leading-and-trailing-spaces'],
    ['Punctuation! Is? Gone.', 'punctuation-is-gone'],
    ['Multiple   Internal    Spaces', 'multiple-internal-spaces'],
    ['Already-Hyphenated-Title', 'already-hyphenated-title'],
    ['--Leading and trailing dashes--', 'leading-and-trailing-dashes'],
    ['UPPERCASE TITLE', 'uppercase-title'],
    ['Under_scores_stay', 'under_scores_stay'],
    ['Mi viaje: día 1', 'mi-viaje-dia-1'],
    ['Crème brûlée & Smørrebrød', 'creme-brulee-smorrebrod'],
    ['a/b/c', 'a-b-c'],
    ['_Leading underscore', 'leading-underscore'],
    ['東京の夏', ''],
    ['Numbers 123 Stay', 'numbers-123-stay'],
    ["Apostrophe's and \"quotes\"", 'apostrophes-and-quotes'],
    ['Collapses -- multiple -- dashes', 'collapses-multiple-dashes'],
  ])('titleToSlug(%j) → %j', (title, expected) => {
    expect(engine.titleToSlug(title)).toBe(expected);
  });
});

// ─── typeToLayout ───────────────────────────────────────────────────────────────

describe('typeToLayout', () => {
  it.each([
    ['blog-list', 'blog'],
    ['blog', 'blog'],
    ['home', 'home'],
    ['markdown', 'page'],
    ['Home page', 'home'],
    ['List of posts', 'blog'],
    ['Regular page', 'page'],
    ['anything-unrecognized', 'page'],
    [undefined, 'page'],
  ])('typeToLayout(%j) → %j', (type, expected) => {
    expect(engine.typeToLayout(type)).toBe(expected);
  });
});

// ─── buildPageFrontMatter ───────────────────────────────────────────────────────

describe('buildPageFrontMatter', () => {
  it('renders the required fields in a fixed order, quoting title', () => {
    const meta = { title: 'About', slug: 'about', description: '' };
    expect(engine.buildPageFrontMatter(meta, 'notion-id-123', 'page')).toBe(
      '---\n' +
      'layout: page\n' +
      'title: "About"\n' +
      'slug: "about"\n' +
      'notion_id: "notion-id-123"\n' +
      '---'
    );
  });

  it('inserts an optional description line only when present', () => {
    const meta = { title: 'About', slug: 'about', description: 'A short blurb' };
    const fm = engine.buildPageFrontMatter(meta, 'id', 'page');
    expect(fm).toContain('description: "A short blurb"');
    // Placed between slug and notion_id.
    expect(fm.split('\n').indexOf('description: "A short blurb"'))
      .toBe(fm.split('\n').indexOf('slug: "about"') + 1);
  });

  it('JSON-escapes quotes inside the title', () => {
    const meta = { title: 'A "quoted" title', slug: 'x', description: '' };
    expect(engine.buildPageFrontMatter(meta, 'id', 'page')).toContain('title: "A \\"quoted\\" title"');
  });
});

// ─── buildPostFrontMatter / postFilename ────────────────────────────────────────

describe('buildPostFrontMatter', () => {
  const baseMeta = () => ({
    title: 'Hello World',
    date: '2026-01-15',
    slug: 'hello-world',
    tags: [],
    description: '',
    coverImage: '',
    canonicalUrl: '',
    featured: false,
  });

  it('renders only the required fields when all optional metadata is empty', () => {
    expect(engine.buildPostFrontMatter(baseMeta(), 'id')).toBe(
      '---\n' +
      'layout: post\n' +
      'title: "Hello World"\n' +
      'date: 2026-01-15\n' +
      'slug: "hello-world"\n' +
      'notion_id: "id"\n' +
      '---'
    );
  });

  it('renders tags as a quoted YAML flow sequence', () => {
    const meta = { ...baseMeta(), tags: ['notion', 'jekyll'] };
    expect(engine.buildPostFrontMatter(meta, 'id')).toContain('tags: ["notion", "jekyll"]');
  });

  it('omits the tags line entirely when there are none', () => {
    expect(engine.buildPostFrontMatter(baseMeta(), 'id')).not.toContain('tags:');
  });

  it('includes excerpt, cover_image and canonical_url only when set', () => {
    const meta = {
      ...baseMeta(),
      description: 'An excerpt',
      coverImage: 'https://example.com/cover.png',
      canonicalUrl: 'https://example.com/original',
    };
    const fm = engine.buildPostFrontMatter(meta, 'id');
    expect(fm).toContain('excerpt: "An excerpt"');
    expect(fm).toContain('cover_image: "https://example.com/cover.png"');
    expect(fm).toContain('canonical_url: "https://example.com/original"');
  });

  it('adds a bare "featured: true" line only when featured, never "featured: false"', () => {
    expect(engine.buildPostFrontMatter({ ...baseMeta(), featured: true }, 'id')).toContain('featured: true');
    expect(engine.buildPostFrontMatter(baseMeta(), 'id')).not.toContain('featured');
  });
});

describe('postFilename', () => {
  it('joins date and slug with a Jekyll-style dated filename', () => {
    expect(engine.postFilename('2026-01-15', 'hello-world')).toBe('2026-01-15-hello-world.md');
  });

  it('uses only the calendar day of a date that carries a time', () => {
    expect(engine.postFilename('2026-01-15T09:30:00.000+09:00', 'hello')).toBe('2026-01-15-hello.md');
  });
});

// ─── Titles, web addresses, dates (row metadata) ────────────────────────────────

describe('row metadata', () => {
  const title = (...parts) => ({ type: 'title', title: parts.map((plain_text) => ({ plain_text })) });
  const text  = (plain_text) => ({ type: 'rich_text', rich_text: [{ plain_text }] });
  const pageRow = (properties, extra = {}) => ({ id: 'abcdef12-0000-4000-8000-000000000000', properties, ...extra });

  it('keeps a title with formatting whole, not just its first part', () => {
    const meta = engine.extractPostMeta(pageRow({ Title: title('My ', 'great', ' trip') }));
    expect(meta.title).toBe('My great trip');
    expect(meta.slug).toBe('my-great-trip');
  });

  it('finds the title column by its type, whatever it is called', () => {
    expect(engine.extractPageMeta(pageRow({ Headline: title('Contact') })).title).toBe('Contact');
  });

  it('reads the v2 column names: Web address, Menu order, Show in menu, friendly Type labels', () => {
    const meta = engine.extractPageMeta(pageRow({
      Title: title('About me'),
      Type: { type: 'select', select: { name: 'Regular page' } },
      'Web address': text('about'),
      'Menu order': { type: 'number', number: 10 },
      'Show in menu': { type: 'checkbox', checkbox: true },
      Summary: text('Who I am'),
    }));
    expect(meta).toMatchObject({ slug: 'about', type: 'markdown', navOrder: 10, showInNav: true, description: 'Who I am' });
    expect(engine.extractPageMeta(pageRow({ Title: title('Home'), Type: { select: { name: 'Home page' } } })).type).toBe('home');
  });

  it('reads the v2 post names: Date, Cover image, Originally published at', () => {
    const meta = engine.extractPostMeta(pageRow({
      Title: title('Trip'),
      Date: { type: 'date', date: { start: '2026-03-01' } },
      'Cover image': { type: 'files', files: [{ type: 'external', external: { url: 'https://example.com/c.jpg' } }] },
      'Originally published at': { type: 'url', url: 'https://example.com/original' },
    }));
    expect(meta).toMatchObject({ date: '2026-03-01', coverImage: 'https://example.com/c.jpg', canonicalUrl: 'https://example.com/original' });
  });

  it('joins every part of the name, tagline and summary too', () => {
    const meta = engine.extractPageMeta(pageRow({
      Title: title('Home'),
      Name: { rich_text: [{ plain_text: 'Ana ' }, { plain_text: 'Silva' }] },
      Tagline: { rich_text: [{ plain_text: 'Potter, ' }, { plain_text: 'teacher' }] },
    }));
    expect(meta.displayName).toBe('Ana Silva');
    expect(meta.tagline).toBe('Potter, teacher');
  });

  it('a post without a date uses the day it was created, so its address does not move daily', () => {
    const meta = engine.extractPostMeta(pageRow({ Title: title('Undated') }, { created_time: '2026-02-03T10:00:00.000Z' }));
    expect(meta.date).toBe('2026-02-03');
  });
});

describe('resolveSlug (stable web addresses)', () => {
  const id = 'abcdef12-0000-4000-8000-000000000000';

  it('keeps a typed address that is already safe exactly as typed', () => {
    expect(engine.resolveSlug({ typed: 'My_Page', title: 'x', existingSlug: '', pageId: id })).toBe('My_Page');
  });

  it('cleans a typed address that would break a URL or a filename', () => {
    expect(engine.resolveSlug({ typed: 'Mi viaje: día 1', title: 'x', existingSlug: '', pageId: id })).toBe('mi-viaje-dia-1');
    expect(engine.resolveSlug({ typed: 'travel/day-1', title: 'x', existingSlug: '', pageId: id })).toBe('travel-day-1');
  });

  it('keeps the address the row already has when only its title changed', () => {
    expect(engine.resolveSlug({ typed: '', title: 'My trip (fixed typo)', existingSlug: 'my-tirp', pageId: id })).toBe('my-tirp');
  });

  it('falls back to the row id when the title has no Latin letters', () => {
    expect(engine.resolveSlug({ typed: '', title: '東京の夏', existingSlug: '', pageId: id })).toBe('page-abcdef12');
  });
});

describe('isFutureDate (scheduled posts)', () => {
  const now = new Date('2026-05-10T12:00:00Z');

  it('compares a plain date as a calendar day', () => {
    expect(engine.isFutureDate('2026-05-10', now)).toBe(false);
    expect(engine.isFutureDate('2026-05-11', now)).toBe(true);
    expect(engine.isFutureDate('2026-05-09', now)).toBe(false);
  });

  it('compares a date with a time as an instant', () => {
    expect(engine.isFutureDate('2026-05-10T14:00:00.000+00:00', now)).toBe(true);
    expect(engine.isFutureDate('2026-05-10T09:00:00.000+00:00', now)).toBe(false);
  });
});

describe('protectLiquid', () => {
  it('leaves ordinary text byte-for-byte alone', () => {
    expect(engine.protectLiquid('Just words.')).toBe('Just words.');
  });

  it('wraps text that Liquid would eat or choke on', () => {
    expect(engine.protectLiquid('Use {{ name }} here')).toBe('{% raw %}\nUse {{ name }} here\n{% endraw %}');
    expect(engine.protectLiquid('{% endraw %} inside')).not.toMatch(/^\{% raw %\}\n\{% endraw %\} inside/);
  });
});
