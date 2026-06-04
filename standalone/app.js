import { buildTranslationPrompt } from '../src/prompt-builder.js';
import { runProjectQa } from '../src/qa.js';
import { createDefaultState, createId, reduceState, selectActiveChapter, selectActiveSegment } from '../src/state.js';
import { splitNovelText } from '../src/segmenter.js';

const STORAGE_KEY = 'st_novel_translator_standalone_v1';

let state = loadState();
let lastPrompt = '';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (error) {
    console.warn('无法读取本地项目', error);
  }
  return createDefaultState();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dispatch(action) {
  state = reduceState(state, action);
  persist();
  render();
}

function render() {
  $('#projectTitle').value = state.project.title;
  $('#sourceLang').value = state.project.sourceLang;
  $('#targetLang').value = state.project.targetLang;
  $('#styleProfile').value = state.project.styleProfile;

  const activeChapter = selectActiveChapter(state);
  const activeSegment = selectActiveSegment(state);
  const chapterSegments = activeChapter ? state.segments.filter((item) => item.chapterId === activeChapter.id) : [];
  const translatedCount = state.segments.filter((item) => item.target.trim()).length;

  $('#chapterCount').textContent = state.chapters.length;
  $('#segmentCount').textContent = state.segments.length;
  $('#translatedCount').textContent = translatedCount;
  $('#activeChapterTitle').textContent = activeChapter?.title ?? '未导入';
  $('#activeSegmentStatus').textContent = activeSegment?.status ?? '未选择';

  $('#chapters').innerHTML = state.chapters.map((chapter) => {
    const all = state.segments.filter((item) => item.chapterId === chapter.id);
    const done = all.filter((item) => item.target.trim()).length;
    return `
      <button class="chapter-item ${chapter.id === state.activeChapterId ? 'active' : ''}" data-chapter="${chapter.id}">
        <span>${escapeHtml(chapter.title)}</span>
        <small>${done}/${all.length}</small>
      </button>
    `;
  }).join('');

  $('#segments').innerHTML = chapterSegments.map((segment, index) => `
    <button class="segment-item ${segment.id === state.activeSegmentId ? 'active' : ''}" data-segment="${segment.id}">
      <strong>${index + 1}</strong>
      <span>${escapeHtml(segment.source.slice(0, 120))}</span>
      <small>${segment.target ? '已译' : '待译'}</small>
    </button>
  `).join('');

  $('#sourceText').value = activeSegment?.source ?? '';
  $('#targetText').value = activeSegment?.target ?? '';
  $('#notesText').value = activeSegment?.notes ?? '';
  $('#qaCount').textContent = state.qaIssues.length;

  renderGlossary();
  renderEntities();
  renderQa();
  bindDynamicEvents();
}

function renderGlossary() {
  $('#glossaryRows').innerHTML = state.glossary.map((item) => `
    <div class="memory-row">
      <input data-kind="glossary" data-id="${item.id}" data-field="sourceTerm" value="${escapeHtml(item.sourceTerm)}" placeholder="原词">
      <input data-kind="glossary" data-id="${item.id}" data-field="targetTerm" value="${escapeHtml(item.targetTerm)}" placeholder="译名">
      <input data-kind="glossary" data-id="${item.id}" data-field="type" value="${escapeHtml(item.type)}" placeholder="类型">
    </div>
  `).join('');
}

function renderEntities() {
  $('#entityRows').innerHTML = state.entities.map((item) => `
    <div class="memory-row">
      <input data-kind="entity" data-id="${item.id}" data-field="sourceName" value="${escapeHtml(item.sourceName)}" placeholder="原名">
      <input data-kind="entity" data-id="${item.id}" data-field="translatedName" value="${escapeHtml(item.translatedName)}" placeholder="译名">
      <input data-kind="entity" data-id="${item.id}" data-field="role" value="${escapeHtml(item.role)}" placeholder="身份">
    </div>
  `).join('');
}

function renderQa() {
  $('#qaRows').innerHTML = state.qaIssues.length
    ? state.qaIssues.map((item) => `
      <div class="qa-item severity-${item.severity}">
        <strong>${escapeHtml(item.type)}</strong>
        <span>${escapeHtml(item.message)}</span>
      </div>
    `).join('')
    : '<p class="empty">还没有检查结果。</p>';
}

function bindDynamicEvents() {
  $$('.chapter-item').forEach((button) => {
    button.onclick = () => dispatch({ type: 'setActiveChapter', chapterId: button.dataset.chapter });
  });

  $$('.segment-item').forEach((button) => {
    button.onclick = () => dispatch({ type: 'setActiveSegment', segmentId: button.dataset.segment });
  });

  $$('[data-kind="glossary"]').forEach((input) => {
    input.onchange = () => dispatch({
      type: 'updateGlossaryEntry',
      id: input.dataset.id,
      patch: { [input.dataset.field]: input.value.trim() },
    });
  });

  $$('[data-kind="entity"]').forEach((input) => {
    input.onchange = () => dispatch({
      type: 'updateEntity',
      id: input.dataset.id,
      patch: { [input.dataset.field]: input.value.trim() },
    });
  });
}

function bindStaticEvents() {
  $('#projectTitle').onchange = saveProject;
  $('#sourceLang').onchange = saveProject;
  $('#targetLang').onchange = saveProject;
  $('#styleProfile').onchange = saveProject;

  $('#fileInput').onchange = async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await importFile(file);
    }
  };

  document.body.ondragover = (event) => {
    event.preventDefault();
    document.body.classList.add('dragging');
  };
  document.body.ondragleave = () => document.body.classList.remove('dragging');
  document.body.ondrop = async (event) => {
    event.preventDefault();
    document.body.classList.remove('dragging');
    const file = event.dataTransfer.files?.[0];
    if (file) {
      await importFile(file);
    }
  };

  $('#fetchUrlBtn').onclick = importFromUrl;
  $('#saveSegmentBtn').onclick = saveSegment;
  $('#buildPromptBtn').onclick = buildPrompt;
  $('#copyPromptBtn').onclick = copyPrompt;
  $('#runQaBtn').onclick = () => dispatch({ type: 'setQaIssues', issues: runProjectQa(state) });
  $('#addGlossaryBtn').onclick = () => dispatch({ type: 'addGlossaryEntry' });
  $('#addEntityBtn').onclick = () => dispatch({ type: 'addEntity' });
  $('#exportJsonBtn').onclick = exportJson;
  $('#exportTxtBtn').onclick = exportTxt;
  $('#exportHtmlBtn').onclick = exportHtml;
  $('#clearBtn').onclick = clearProject;
}

function saveProject() {
  dispatch({
    type: 'updateProject',
    patch: {
      title: $('#projectTitle').value.trim() || '未命名小说',
      sourceLang: $('#sourceLang').value.trim() || '原文',
      targetLang: $('#targetLang').value.trim() || '译文',
      styleProfile: $('#styleProfile').value.trim(),
    },
  });
}

async function importFile(file) {
  setHint(`正在读取：${file.name}`);
  const ext = file.name.toLowerCase().split('.').pop();
  try {
    if (ext === 'epub') {
      const text = await readEpub(file);
      replaceContent(text, file.name.replace(/\.epub$/i, ''));
      setHint('EPUB 已导入。');
      return;
    }
    const text = await file.text();
    replaceContent(text, file.name.replace(/\.(txt|md)$/i, ''));
    setHint('文本已导入。');
  } catch (error) {
    console.error(error);
    setHint(`导入失败：${error.message}`);
  }
}

async function readEpub(file) {
  if (!globalThis.JSZip) {
    throw new Error('JSZip 未加载，无法解析 EPUB。请检查网络或改用 TXT。');
  }

  const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  const container = await zip.file('META-INF/container.xml')?.async('text');
  if (!container) {
    throw new Error('EPUB 缺少 container.xml。');
  }

  const containerDoc = parseXml(container);
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) {
    throw new Error('EPUB 缺少 OPF 路径。');
  }

  const opfText = await zip.file(opfPath)?.async('text');
  const opfDoc = parseXml(opfText);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map(Array.from(opfDoc.querySelectorAll('manifest item')).map((item) => [
    item.getAttribute('id'),
    item.getAttribute('href'),
  ]));
  const spine = Array.from(opfDoc.querySelectorAll('spine itemref')).map((item) => item.getAttribute('idref'));
  const chapters = [];

  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) {
      continue;
    }
    const path = normalizeZipPath(base + href);
    const html = await zip.file(path)?.async('text');
    if (!html) {
      continue;
    }
    const text = htmlToText(html);
    if (text.trim()) {
      chapters.push(text.trim());
    }
  }

  return chapters.join('\n\n');
}

function replaceContent(text, title) {
  const parsed = splitNovelText(text);
  state = reduceState(state, {
    type: 'updateProject',
    patch: { title: title || state.project.title },
  });
  state = reduceState(state, {
    type: 'replaceNovelContent',
    chapters: parsed.chapters,
    segments: parsed.segments,
  });
  persist();
  render();
}

async function importFromUrl() {
  const url = $('#urlInput').value.trim();
  if (!url) {
    setHint('请输入网址。');
    return;
  }
  setHint('正在尝试读取网页。若失败，需要后端代理。');

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const text = htmlToText(html);
    replaceContent(text, new URL(url).hostname);
    setHint('网页已读取。若内容不完整，请改用本地抓取服务。');
  } catch (directError) {
    try {
      const proxyUrl = `http://localhost:8787/api/fetch?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error(`本地服务 HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      replaceContent(payload.text, payload.title || new URL(url).hostname);
      setHint('已通过本地抓取服务读取网页。');
    } catch (proxyError) {
      setHint(`读取失败：${directError.message}；本地抓取服务也不可用：${proxyError.message}`);
    }
  }
}

function saveSegment() {
  const segment = selectActiveSegment(state);
  if (!segment) {
    return;
  }
  dispatch({
    type: 'updateSegment',
    segmentId: segment.id,
    patch: {
      target: $('#targetText').value.trim(),
      notes: $('#notesText').value.trim(),
      status: $('#targetText').value.trim() ? 'translated' : 'draft',
    },
  });
}

function buildPrompt() {
  saveProject();
  lastPrompt = buildTranslationPrompt(state);
  $('#promptOutput').value = lastPrompt;
}

async function copyPrompt() {
  if (!lastPrompt) {
    buildPrompt();
  }
  await navigator.clipboard.writeText($('#promptOutput').value);
  setHint('提示词已复制。');
}

function exportJson() {
  download(`${safeName(state.project.title)}.json`, JSON.stringify(state, null, 2), 'application/json');
}

function exportTxt() {
  const text = state.chapters.map((chapter) => {
    const segments = state.segments.filter((item) => item.chapterId === chapter.id);
    const body = segments.map((item) => item.target || item.source).join('\n\n');
    return `${chapter.title}\n\n${body}`;
  }).join('\n\n');
  download(`${safeName(state.project.title)}.txt`, text, 'text/plain;charset=utf-8');
}

function exportHtml() {
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${escapeHtml(state.project.title)}</title>
<style>body{font-family:system-ui,sans-serif;line-height:1.8;max-width:880px;margin:40px auto;padding:0 20px}.seg{border-bottom:1px solid #ddd;padding:16px 0}.src{color:#666}.tgt{font-size:1.08em}</style></head>
<body>
<h1>${escapeHtml(state.project.title)}</h1>
${state.chapters.map((chapter) => `<h2>${escapeHtml(chapter.title)}</h2>${state.segments
    .filter((item) => item.chapterId === chapter.id)
    .map((item) => `<div class="seg"><p class="src">${escapeHtml(item.source)}</p><p class="tgt">${escapeHtml(item.target)}</p></div>`)
    .join('')}`).join('')}
</body></html>`;
  download(`${safeName(state.project.title)}.html`, html, 'text/html;charset=utf-8');
}

function clearProject() {
  if (!confirm('确定清空当前项目吗？')) {
    return;
  }
  state = createDefaultState();
  persist();
  render();
}

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer,aside').forEach((node) => node.remove());
  const title = doc.querySelector('h1,h2,title')?.textContent?.trim();
  const paragraphs = Array.from(doc.querySelectorAll('p, h1, h2, h3, .widget-episodeBody, .js-episode-body'))
    .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const unique = dedupe([title, ...paragraphs].filter(Boolean));
  return unique.join('\n\n');
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

function normalizeZipPath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeName(name) {
  return String(name || 'novel-translation').replace(/[\\/:*?"<>|]+/g, '_');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setHint(message) {
  $('#importHint').textContent = message;
}

bindStaticEvents();
render();
