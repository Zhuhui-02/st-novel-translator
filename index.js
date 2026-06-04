import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { createDefaultState, exportState, importState, normalizeState, reduceState, selectActiveChapter, selectActiveSegment } from './src/state.js';
import { splitNovelText } from './src/segmenter.js';
import { buildReviewPrompt, buildTranslationPrompt } from './src/prompt-builder.js';
import { runProjectQa } from './src/qa.js';
import { loadState, saveState } from './src/storage.js';
import { htmlToText, readEpubFile } from './src/epub.js';

const EXTENSION_NAME = 'st-novel-translator';
const SETTINGS_KEY = 'novelTranslator';

let state = createDefaultState();
let context = null;
let root = null;
let saveTimer = null;
let workspaceOpen = false;
let memoryTab = 'glossary';
let hint = '选择 TXT / EPUB，或粘贴网页地址尝试读取。';

function ensureSettings() {
  extension_settings[SETTINGS_KEY] ??= {
    activeProjectId: null,
    autoSaveDelayMs: 250,
  };
  return extension_settings[SETTINGS_KEY];
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveState(state);
    saveSettingsDebounced();
  }, ensureSettings().autoSaveDelayMs);
}

function dispatch(action) {
  state = reduceState(state, action);
  scheduleSave();
  render();
}

function updateState(action, shouldRender = true) {
  state = reduceState(state, action);
  scheduleSave();
  if (shouldRender) {
    render();
  }
}

function value(id) {
  return root.querySelector(`#${id}`)?.value?.trim() ?? '';
}

function setValue(id, nextValue) {
  const element = root.querySelector(`#${id}`);
  if (element) {
    element.value = nextValue;
  }
}

function escapeHtml(nextValue) {
  return String(nextValue ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function mount() {
  const extensionsMenu = document.querySelector('#extensions_settings');
  if (!extensionsMenu) {
    return false;
  }

  if (document.querySelector('#novel_translator_panel')) {
    root = document.querySelector('#novel_translator_panel');
    return true;
  }

  const container = document.createElement('div');
  container.id = 'novel_translator_panel';
  container.className = 'novel-translator-extension';
  extensionsMenu.appendChild(container);
  root = container;
  return true;
}

function render() {
  if (!root) {
    return;
  }

  const translatedCount = state.segments.filter((item) => item.target.trim()).length;
  const totalCount = state.segments.length;
  const progress = totalCount ? Math.round((translatedCount / totalCount) * 100) : 0;

  root.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>小说翻译插件</b>
        <div class="novel-translator-progress">${translatedCount}/${totalCount} · ${progress}%</div>
      </div>
      <div class="inline-drawer-content novel-translator-launcher">
        <div>
          <strong>${escapeHtml(state.project.title)}</strong>
          <p>在 SillyTavern 内打开小说翻译工作台，管理章节、段落、术语、人名与提示词。</p>
        </div>
        <button id="nt_open_workspace_btn" class="menu_button">打开小说翻译工作台</button>
      </div>
    </div>
    ${workspaceOpen ? renderWorkspace() : ''}
  `;

  bindEvents();
}

function renderWorkspace() {
  const project = state.project;
  const activeChapter = selectActiveChapter(state);
  const activeSegment = selectActiveSegment(state);
  const chapterSegments = activeChapter ? state.segments.filter((item) => item.chapterId === activeChapter.id) : [];
  const translatedCount = state.segments.filter((item) => item.target.trim()).length;

  return `
    <div class="nt-workspace-backdrop">
      <section class="nt-workspace">
        <header class="nt-workspace-header">
          <div>
            <h2>小说翻译工作台</h2>
            <p>内嵌在 SillyTavern 的项目面板，支持 TXT / EPUB 导入、提示词生成、记忆表和导出。</p>
          </div>
          <div class="nt-header-actions">
            <button id="nt_send_prompt_top_btn" class="menu_button">发送提示词</button>
            <button id="nt_close_workspace_btn" class="menu_button">关闭</button>
          </div>
        </header>

        <div class="nt-workspace-stats">
          <span><b>${state.chapters.length}</b> 章节</span>
          <span><b>${state.segments.length}</b> 段落</span>
          <span><b>${translatedCount}</b> 已译</span>
          <span><b>${state.qaIssues.length}</b> 检查项</span>
        </div>

        <div class="nt-workspace-grid">
          <aside class="nt-side-column">
            <section class="nt-panel">
              <h3>项目</h3>
              <label>书名
                <input id="nt_project_title" class="text_pole" value="${escapeHtml(project.title)}" placeholder="未命名小说">
              </label>
              <div class="novel-translator-row">
                <label>原文
                  <input id="nt_source_lang" class="text_pole" value="${escapeHtml(project.sourceLang)}" placeholder="日文">
                </label>
                <label>译文
                  <input id="nt_target_lang" class="text_pole" value="${escapeHtml(project.targetLang)}" placeholder="中文">
                </label>
              </div>
              <label>风格要求
                <textarea id="nt_style_profile" class="text_pole textarea_compact" rows="5" placeholder="轻小说口吻、称谓策略、专名规则等">${escapeHtml(project.styleProfile)}</textarea>
              </label>
              <button id="nt_save_project" class="menu_button">保存项目</button>
            </section>

            <section class="nt-panel">
              <h3>导入</h3>
              <label class="nt-file-button">
                <input id="nt_file_input" type="file" accept=".txt,.md,.epub,text/plain,application/epub+zip">
                <span>选择 TXT / EPUB</span>
              </label>
              <label>粘贴文本
                <textarea id="nt_import_text" class="text_pole textarea_compact" rows="6" placeholder="也可以直接粘贴小说文本"></textarea>
              </label>
              <button id="nt_import_text_btn" class="menu_button">导入粘贴文本</button>
              <label>网页地址
                <input id="nt_url_input" class="text_pole" type="url" placeholder="https://kakuyomu.jp/works/...">
              </label>
              <button id="nt_fetch_url_btn" class="menu_button">尝试读取网页</button>
              <p class="nt-hint">${escapeHtml(hint)}</p>
            </section>

            <section class="nt-panel">
              <h3>导出</h3>
              <div class="novel-translator-actions">
                <button id="nt_export_json_btn" class="menu_button">JSON</button>
                <button id="nt_export_txt_btn" class="menu_button">TXT</button>
                <button id="nt_export_html_btn" class="menu_button">HTML</button>
              </div>
              <label>导入 JSON
                <textarea id="nt_import_json" class="text_pole textarea_compact" rows="4" placeholder="粘贴此前导出的项目 JSON"></textarea>
              </label>
              <button id="nt_import_json_btn" class="menu_button">读取 JSON</button>
            </section>
          </aside>

          <section class="nt-list-column">
            <div class="nt-section-title">
              <h3>章节</h3>
              <button id="nt_run_qa_btn" class="menu_button">检查</button>
            </div>
            <div class="novel-translator-chapters">
              ${state.chapters.map((chapter) => {
                const chapterItems = state.segments.filter((item) => item.chapterId === chapter.id);
                const done = chapterItems.filter((item) => item.target.trim()).length;
                return `
                  <button class="novel-translator-chapter ${chapter.id === state.activeChapterId ? 'active' : ''}" data-chapter-id="${chapter.id}">
                    <span>${escapeHtml(chapter.title)}</span>
                    <small>${done}/${chapterItems.length}</small>
                  </button>
                `;
              }).join('')}
            </div>

            <div class="nt-section-title">
              <h3>段落</h3>
              <span>${activeChapter ? escapeHtml(activeChapter.title) : '未导入'}</span>
            </div>
            <div class="novel-translator-segments">
              ${chapterSegments.map((segment, index) => `
                <button class="novel-translator-segment ${segment.id === state.activeSegmentId ? 'active' : ''}" data-segment-id="${segment.id}">
                  <span>${index + 1}. ${escapeHtml(segment.source.slice(0, 96))}</span>
                  <small>${segment.target ? '已译' : '待译'}</small>
                </button>
              `).join('')}
            </div>
          </section>

          <section class="nt-editor-column">
            <div class="nt-section-title">
              <h3>翻译编辑</h3>
              <span>${activeSegment ? escapeHtml(activeSegment.status) : '未选择'}</span>
            </div>
            <label>原文
              <textarea id="nt_segment_source" class="text_pole textarea_compact" rows="8" readonly>${escapeHtml(activeSegment?.source ?? '')}</textarea>
            </label>
            <label>译文
              <textarea id="nt_segment_target" class="text_pole textarea_compact" rows="8" placeholder="在这里输入或粘贴译文">${escapeHtml(activeSegment?.target ?? '')}</textarea>
            </label>
            <label>备注
              <textarea id="nt_segment_notes" class="text_pole textarea_compact" rows="3" placeholder="译名、风格或问题记录">${escapeHtml(activeSegment?.notes ?? '')}</textarea>
            </label>
            <div class="novel-translator-actions">
              <button id="nt_save_segment_btn" class="menu_button">保存段落</button>
              <button id="nt_prompt_btn" class="menu_button">生成翻译提示词</button>
              <button id="nt_review_prompt_btn" class="menu_button">生成审校提示词</button>
            </div>
            <label>提示词
              <textarea id="nt_prompt_output" class="text_pole textarea_compact" rows="8" placeholder="生成后可复制或发送到聊天输入框"></textarea>
            </label>
            <div class="novel-translator-actions">
              <button id="nt_copy_prompt_btn" class="menu_button">复制提示词</button>
              <button id="nt_send_prompt_btn" class="menu_button">发送到聊天</button>
            </div>
          </section>

          <section class="nt-memory-column">
            <div class="novel-translator-tabs">
              <button class="menu_button nt-tab ${memoryTab === 'glossary' ? 'active' : ''}" data-tab="glossary">术语</button>
              <button class="menu_button nt-tab ${memoryTab === 'entities' ? 'active' : ''}" data-tab="entities">人物</button>
              <button class="menu_button nt-tab ${memoryTab === 'style' ? 'active' : ''}" data-tab="style">风格</button>
              <button class="menu_button nt-tab ${memoryTab === 'qa' ? 'active' : ''}" data-tab="qa">检查</button>
            </div>
            <div id="nt_memory_panel">${renderMemoryPanel(memoryTab)}</div>
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderMemoryPanel(tab) {
  if (tab === 'entities') {
    return `
      <div class="novel-translator-table">
        ${state.entities.map((item) => `
          <div class="novel-translator-memory-row">
            <input class="text_pole nt-entity-source" data-id="${item.id}" value="${escapeHtml(item.sourceName)}" placeholder="原名">
            <input class="text_pole nt-entity-target" data-id="${item.id}" value="${escapeHtml(item.translatedName)}" placeholder="译名">
            <input class="text_pole nt-entity-role" data-id="${item.id}" value="${escapeHtml(item.role)}" placeholder="身份">
          </div>
        `).join('')}
      </div>
      <button id="nt_add_entity_btn" class="menu_button wide100p">添加人物</button>
    `;
  }

  if (tab === 'style') {
    return `
      <div class="novel-translator-table">
        ${state.styleRules.map((item) => `
          <div class="novel-translator-memory-row two">
            <input class="text_pole nt-style-rule" data-id="${item.id}" value="${escapeHtml(item.rule)}" placeholder="风格规则">
            <input class="text_pole nt-style-example" data-id="${item.id}" value="${escapeHtml(item.examples)}" placeholder="例句">
          </div>
        `).join('')}
      </div>
      <button id="nt_add_style_btn" class="menu_button wide100p">添加风格规则</button>
    `;
  }

  if (tab === 'qa') {
    return `
      <div class="novel-translator-qa">
        ${state.qaIssues.length ? state.qaIssues.map((issue) => `
          <div class="novel-translator-qa-item severity-${issue.severity}">
            <b>${escapeHtml(issue.type)}</b>
            <span>${escapeHtml(issue.message)}</span>
            <small>${escapeHtml(issue.segmentId)}</small>
          </div>
        `).join('') : '<div class="novel-translator-empty">还没有检查结果。</div>'}
      </div>
    `;
  }

  return `
    <div class="novel-translator-table">
      ${state.glossary.map((item) => `
        <div class="novel-translator-memory-row">
          <input class="text_pole nt-glossary-source" data-id="${item.id}" value="${escapeHtml(item.sourceTerm)}" placeholder="原词">
          <input class="text_pole nt-glossary-target" data-id="${item.id}" value="${escapeHtml(item.targetTerm)}" placeholder="译名">
          <input class="text_pole nt-glossary-type" data-id="${item.id}" value="${escapeHtml(item.type)}" placeholder="类型">
        </div>
      `).join('')}
    </div>
    <button id="nt_add_glossary_btn" class="menu_button wide100p">添加术语</button>
  `;
}

function bindEvents() {
  root.querySelector('#nt_open_workspace_btn')?.addEventListener('click', () => {
    workspaceOpen = true;
    render();
  });

  root.querySelector('#nt_close_workspace_btn')?.addEventListener('click', () => {
    workspaceOpen = false;
    render();
  });

  root.querySelector('#nt_save_project')?.addEventListener('click', () => saveProject());

  root.querySelector('#nt_file_input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await importFile(file);
    }
  });

  root.querySelector('#nt_import_text_btn')?.addEventListener('click', () => {
    const text = value('nt_import_text');
    if (!text) {
      return;
    }
    replaceNovelContent(text, state.project.title);
    hint = '文本已导入。';
    render();
  });

  root.querySelector('#nt_fetch_url_btn')?.addEventListener('click', importFromUrl);

  root.querySelector('#nt_export_json_btn')?.addEventListener('click', () => {
    download(`${safeName(state.project.title)}.json`, exportState(state), 'application/json;charset=utf-8');
  });

  root.querySelector('#nt_export_txt_btn')?.addEventListener('click', () => {
    download(`${safeName(state.project.title)}.txt`, buildTxtExport(), 'text/plain;charset=utf-8');
  });

  root.querySelector('#nt_export_html_btn')?.addEventListener('click', () => {
    download(`${safeName(state.project.title)}.html`, buildHtmlExport(), 'text/html;charset=utf-8');
  });

  root.querySelector('#nt_import_json_btn')?.addEventListener('click', () => {
    const json = value('nt_import_json');
    if (json) {
      dispatch({ type: 'replaceState', state: importState(json) });
    }
  });

  root.querySelectorAll('.novel-translator-chapter').forEach((button) => {
    button.addEventListener('click', () => dispatch({ type: 'setActiveChapter', chapterId: button.dataset.chapterId }));
  });

  root.querySelectorAll('.novel-translator-segment').forEach((button) => {
    button.addEventListener('click', () => dispatch({ type: 'setActiveSegment', segmentId: button.dataset.segmentId }));
  });

  root.querySelector('#nt_save_segment_btn')?.addEventListener('click', () => saveSegment());
  root.querySelector('#nt_prompt_btn')?.addEventListener('click', () => {
    saveProject(false);
    setValue('nt_prompt_output', buildTranslationPrompt(state));
  });
  root.querySelector('#nt_review_prompt_btn')?.addEventListener('click', () => {
    saveProject(false);
    setValue('nt_prompt_output', buildReviewPrompt(state));
  });
  root.querySelector('#nt_copy_prompt_btn')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(value('nt_prompt_output'));
  });
  root.querySelector('#nt_send_prompt_btn')?.addEventListener('click', () => {
    sendPromptToChat(value('nt_prompt_output'));
  });
  root.querySelector('#nt_send_prompt_top_btn')?.addEventListener('click', () => {
    const prompt = value('nt_prompt_output') || buildTranslationPrompt(state);
    sendPromptToChat(prompt);
  });

  root.querySelector('#nt_run_qa_btn')?.addEventListener('click', () => {
    memoryTab = 'qa';
    dispatch({ type: 'setQaIssues', issues: runProjectQa(state) });
  });

  root.querySelectorAll('.nt-tab').forEach((button) => {
    button.addEventListener('click', () => {
      memoryTab = button.dataset.tab;
      render();
    });
  });

  bindMemoryEvents();
}

function bindMemoryEvents() {
  root.querySelector('#nt_add_glossary_btn')?.addEventListener('click', () => dispatch({ type: 'addGlossaryEntry' }));
  root.querySelector('#nt_add_entity_btn')?.addEventListener('click', () => dispatch({ type: 'addEntity' }));
  root.querySelector('#nt_add_style_btn')?.addEventListener('click', () => dispatch({ type: 'addStyleRule' }));

  root.querySelectorAll('.nt-glossary-source, .nt-glossary-target, .nt-glossary-type').forEach((input) => {
    input.addEventListener('change', () => dispatch({
      type: 'updateGlossaryEntry',
      id: input.dataset.id,
      patch: glossaryPatchFromInput(input),
    }));
  });

  root.querySelectorAll('.nt-entity-source, .nt-entity-target, .nt-entity-role').forEach((input) => {
    input.addEventListener('change', () => dispatch({
      type: 'updateEntity',
      id: input.dataset.id,
      patch: entityPatchFromInput(input),
    }));
  });

  root.querySelectorAll('.nt-style-rule, .nt-style-example').forEach((input) => {
    input.addEventListener('change', () => dispatch({
      type: 'updateStyleRule',
      id: input.dataset.id,
      patch: stylePatchFromInput(input),
    }));
  });
}

function saveProject(shouldRender = true) {
  updateState({
    type: 'updateProject',
    patch: {
      title: value('nt_project_title') || '未命名小说',
      sourceLang: value('nt_source_lang') || '日文',
      targetLang: value('nt_target_lang') || '中文',
      styleProfile: value('nt_style_profile'),
    },
  }, shouldRender);
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
      target: value('nt_segment_target'),
      notes: value('nt_segment_notes'),
      status: value('nt_segment_target') ? 'translated' : 'draft',
    },
  });
}

async function importFile(file) {
  try {
    hint = `正在读取 ${file.name}...`;
    render();
    const lowerName = file.name.toLowerCase();
    const text = lowerName.endsWith('.epub') ? await readEpubFile(file) : await file.text();
    replaceNovelContent(text, file.name.replace(/\.(txt|md|epub)$/i, ''));
    hint = `${file.name} 已导入。`;
  } catch (error) {
    console.error(error);
    hint = `导入失败：${error.message}`;
  }
  render();
}

async function importFromUrl() {
  const url = value('nt_url_input');
  if (!url) {
    hint = '请输入网页地址。';
    render();
    return;
  }

  hint = '正在尝试读取网页。若站点禁止跨域，后续需要接入 Server Plugin 代理。';
  render();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    replaceNovelContent(htmlToText(html), new URL(url).hostname);
    hint = '网页已读取。若内容不完整，说明需要站点专用抓取器。';
  } catch (error) {
    hint = `浏览器无法直接读取：${error.message}。Kakuyomu 等站点建议下一步做 Server Plugin 代理抓取。`;
  }
  render();
}

function replaceNovelContent(text, title) {
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
  scheduleSave();
}

function glossaryPatchFromInput(input) {
  if (input.classList.contains('nt-glossary-source')) return { sourceTerm: input.value.trim() };
  if (input.classList.contains('nt-glossary-target')) return { targetTerm: input.value.trim() };
  return { type: input.value.trim() };
}

function entityPatchFromInput(input) {
  if (input.classList.contains('nt-entity-source')) return { sourceName: input.value.trim() };
  if (input.classList.contains('nt-entity-target')) return { translatedName: input.value.trim() };
  return { role: input.value.trim() };
}

function stylePatchFromInput(input) {
  if (input.classList.contains('nt-style-rule')) return { rule: input.value.trim() };
  return { examples: input.value.trim() };
}

function sendPromptToChat(prompt) {
  if (!prompt) {
    return;
  }

  const textarea = document.querySelector('#send_textarea');
  if (textarea) {
    textarea.value = prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    return;
  }

  context?.setChatMessage?.({ mes: prompt });
}

function buildTxtExport() {
  return state.chapters.map((chapter) => {
    const body = state.segments
      .filter((segment) => segment.chapterId === chapter.id)
      .map((segment) => segment.target || segment.source)
      .join('\n\n');
    return `${chapter.title}\n\n${body}`;
  }).join('\n\n');
}

function buildHtmlExport() {
  const chapters = state.chapters.map((chapter) => {
    const segments = state.segments
      .filter((segment) => segment.chapterId === chapter.id)
      .map((segment) => `<div class="segment"><p class="source">${escapeHtml(segment.source)}</p><p class="target">${escapeHtml(segment.target)}</p></div>`)
      .join('');
    return `<section><h2>${escapeHtml(chapter.title)}</h2>${segments}</section>`;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(state.project.title)}</title>
  <style>
    body{font-family:system-ui,sans-serif;line-height:1.8;max-width:920px;margin:40px auto;padding:0 20px}
    .segment{border-bottom:1px solid #ddd;padding:14px 0}.source{color:#666}.target{font-size:1.08em}
  </style>
</head>
<body><h1>${escapeHtml(state.project.title)}</h1>${chapters}</body>
</html>`;
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

async function init() {
  context = getContext();
  ensureSettings();
  state = normalizeState(await loadState());

  const mounted = mount();
  if (!mounted) {
    setTimeout(init, 500);
    return;
  }

  render();
}

jQuery(init);

window.novelTranslatorInterceptor = async function novelTranslatorInterceptor(chat) {
  return chat;
};

console.debug(`[${EXTENSION_NAME}] loaded`);
