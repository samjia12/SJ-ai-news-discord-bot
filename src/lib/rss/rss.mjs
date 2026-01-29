import Parser from 'rss-parser';

const parser = new Parser();

export async function fetchRssItems(rssUrl) {
  const feed = await parser.parseURL(rssUrl);
  const items = (feed.items || []).map((it) => {
    const link = it.link || '';
    const guid = it.guid || '';
    const key = guid || link;
    const text = normalizeText(it.contentSnippet || it.content || it.summary || it.title || '');

    return {
      key,
      link,
      title: it.title || '',
      text,
      isoDate: it.isoDate || null,
      pubDate: it.pubDate || null,
    };
  });

  return items.filter((x) => x.key && x.text);
}

function normalizeText(s) {
  return String(s)
    .replace(/\s+/g, ' ')
    .trim();
}
