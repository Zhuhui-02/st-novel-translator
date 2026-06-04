const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

export async function readEpubFile(file) {
  const JSZip = await ensureJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const container = await zip.file('META-INF/container.xml')?.async('text');
  if (!container) {
    throw new Error('EPUB 缺少 META-INF/container.xml');
  }

  const containerDoc = parseXml(container);
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) {
    throw new Error('EPUB 缺少 OPF 路径');
  }

  const opfText = await zip.file(opfPath)?.async('text');
  if (!opfText) {
    throw new Error('无法读取 EPUB OPF 文件');
  }

  const opfDoc = parseXml(opfText);
  const basePath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map(Array.from(opfDoc.querySelectorAll('manifest item')).map((item) => [
    item.getAttribute('id'),
    item.getAttribute('href'),
  ]));
  const spineIds = Array.from(opfDoc.querySelectorAll('spine itemref')).map((item) => item.getAttribute('idref'));
  const chapterTexts = [];

  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) {
      continue;
    }
    const path = normalizeZipPath(basePath + decodeURIComponent(href));
    const html = await zip.file(path)?.async('text');
    if (!html) {
      continue;
    }
    const text = htmlToText(html);
    if (text.trim()) {
      chapterTexts.push(text.trim());
    }
  }

  return chapterTexts.join('\n\n');
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, nav, header, footer, aside').forEach((node) => node.remove());
  const title = doc.querySelector('h1, h2, title')?.textContent?.trim();
  const blocks = Array.from(doc.querySelectorAll('p, h1, h2, h3, li, blockquote, .widget-episodeBody, .js-episode-body'))
    .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return dedupe([title, ...blocks].filter(Boolean)).join('\n\n');
}

async function ensureJSZip() {
  if (globalThis.JSZip) {
    return globalThis.JSZip;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSZIP_CDN;
    script.onload = resolve;
    script.onerror = () => reject(new Error('无法加载 JSZip，EPUB 导入需要网络或内置依赖'));
    document.head.appendChild(script);
  });

  if (!globalThis.JSZip) {
    throw new Error('JSZip 加载失败');
  }
  return globalThis.JSZip;
}

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function normalizeZipPath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
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
