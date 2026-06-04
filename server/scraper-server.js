import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const USER_AGENT = 'st-novel-translator/0.1.0 (+local translation workspace)';
const MAX_EPISODES = Number(process.env.MAX_EPISODES || 20);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 800);

const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://localhost:${PORT}`);
  if (requestUrl.pathname !== '/api/fetch') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const target = requestUrl.searchParams.get('url');
  if (!target) {
    sendJson(response, 400, { error: 'Missing url parameter' });
    return;
  }

  try {
    const result = await fetchNovel(target);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Novel scraper server listening on http://localhost:${PORT}`);
});

async function fetchNovel(target) {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) URLs are supported.');
  }

  if (url.hostname.endsWith('kakuyomu.jp')) {
    return fetchKakuyomu(url);
  }

  const html = await fetchText(url);
  return {
    title: extractTitle(html) || url.hostname,
    sourceUrl: url.toString(),
    text: htmlToText(html),
    chapters: [],
  };
}

async function fetchKakuyomu(url) {
  const html = await fetchText(url);
  const episodeUrls = extractKakuyomuEpisodeUrls(html, url);

  if (episodeUrls.length && !isEpisodeUrl(url)) {
    const chapters = [];
    for (const episodeUrl of episodeUrls.slice(0, MAX_EPISODES)) {
      await delay(REQUEST_DELAY_MS);
      const episodeHtml = await fetchText(episodeUrl);
      chapters.push({
        title: extractTitle(episodeHtml) || episodeUrl.pathname.split('/').pop(),
        url: episodeUrl.toString(),
        text: extractKakuyomuText(episodeHtml),
      });
    }
    return {
      title: extractTitle(html) || 'Kakuyomu work',
      sourceUrl: url.toString(),
      chapters,
      text: chapters.map((item) => `${item.title}\n\n${item.text}`).join('\n\n'),
    };
  }

  return {
    title: extractTitle(html) || 'Kakuyomu episode',
    sourceUrl: url.toString(),
    text: extractKakuyomuText(html),
    chapters: [],
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while reading ${url}`);
  }
  return response.text();
}

function extractKakuyomuEpisodeUrls(html, baseUrl) {
  const workId = baseUrl.pathname.match(/\/works\/(\d+)/)?.[1];
  if (!workId) {
    return [];
  }

  const urls = new Set();
  const pattern = new RegExp(`/works/${workId}/episodes/\\d+`, 'g');
  for (const match of html.matchAll(pattern)) {
    urls.add(new URL(match[0], baseUrl).toString());
  }
  return Array.from(urls).map((value) => new URL(value));
}

function isEpisodeUrl(url) {
  return /\/works\/\d+\/episodes\/\d+/.test(url.pathname);
}

function extractKakuyomuText(html) {
  const nextData = extractNextDataText(html);
  if (nextData) {
    return nextData;
  }
  return htmlToText(html);
}

function extractNextDataText(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    return '';
  }

  try {
    const data = JSON.parse(decodeHtml(match[1]));
    const strings = [];
    collectLongText(data, strings);
    return strings
      .filter((item) => /[ぁ-んァ-ン一-龯]/.test(item))
      .filter((item) => item.length > 40)
      .slice(0, 80)
      .join('\n\n');
  } catch {
    return '';
  }
}

function collectLongText(value, output) {
  if (!value) {
    return;
  }
  if (typeof value === 'string') {
    const clean = value.replace(/\r\n/g, '\n').replace(/\s+\n/g, '\n').trim();
    if (clean.length > 40) {
      output.push(clean);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLongText(item, output));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectLongText(item, output));
  }
}

function htmlToText(html) {
  const title = extractTitle(html);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(p|h1|h2|h3|br|div|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => decodeHtml(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return dedupe([title, ...stripped].filter(Boolean)).join('\n\n');
}

function extractTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? '';
  return decodeHtml(title.replace(/<[^>]+>/g, '')).trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
