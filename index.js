import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { createDefaultState, exportState, importState, normalizeState, reduceState, selectActiveChapter, selectActiveSegment } from './src/state.js';
import { splitNovelText } from './src/segmenter.js';
import { buildReviewPrompt, buildTranslationPrompt } from './src/prompt-builder.js';
import { runProjectQa } from './src/qa.js';
import { loadState, saveState } from './src/storage.js';

const EXTENSION_NAME = 'st-novel-translator';
const SETTINGS_KEY = 'novelTranslator';

let state = createDefaultState();
let context = null;
let root = null;
let saveTimer = null;

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

function getTextAreaValue(id) {
  return root.querySelector(`#${id}`)?.value?.trim() ?? '';
}

function setTextAreaValue(id, value) {
  const element = root.querySelector(`#${id}`);
  if (element) {
    element.value = value;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
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

  const project = state.project;
  const activeChapter = selectActiveChapter(state);
  const activeSegment = selectActiveSegment(state);
  const chapters = state.chapters;
  const segments = activeChapter ? state.segments.filter((item) => item.chapterId === activeChapter.id) : [];
  const completedCount = state.segments.filter((item) => item.status === 'translated' || item.status === 'reviewed').length;
  const totalCount = state.segments.length;
  const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  root.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Novel Translator</b>
        <div class="novel-translator-progress">${completedCount}/${totalCount} · ${progress}%</div>
      </div>
      <div class="inline-drawer-content novel-translator-body">
        <div class="novel-translator-grid">
          <section class="novel-translator-pane novel-translator-project">
            <label>Project title</label>
            <input id="nt_project_title" class="text_pole" value="${escapeHtml(project.title)}" placeholder="Untitled novel">
            <div class="novel-translator-row">
              <input id="nt_source_lang" class="text_pole" value="${escapeHtml(project.sourceLang)}" placeholder="Source">
              <input id="nt_target_lang" class="text_pole" value="${escapeHtml(project.targetLang)}" placeholder="Target">
            </div>
            <label>Style profile</label>
            <textarea id="nt_style_profile" class="text_pole textarea_compact" rows="4" placeholder="Tone, register, naming conventions...">${escapeHtml(project.styleProfile)}</textarea>
            <label>Import text</label>
            <textarea id="nt_import_text" class="text_pole textarea_compact" rows="7" placeholder="Paste TXT or Markdown novel text here"></textarea>
            <div class="novel-translator-actions">
              <button id="nt_save_project" class="menu_button">Save project</button>
              <button id="nt_import_text_btn" class="menu_button">Import</button>
              <button id="nt_export_json_btn" class="menu_button">Export JSON</button>
            </div>
            <label>Import JSON</label>
            <textarea id="nt_import_json" class="text_pole textarea_compact" rows="4" placeholder="Paste exported project JSON"></textarea>
            <button id="nt_import_json_btn" class="menu_button wide100p">Load JSON</button>
          </section>

          <section class="novel-translator-pane">
            <div class="novel-translator-split-header">
              <b>Chapters</b>
              <button id="nt_run_qa_btn" class="menu_button">Run QA</button>
            </div>
            <div class="novel-translator-chapters">
              ${chapters.map((chapter) => `
                <button class="novel-translator-chapter ${chapter.id === state.activeChapterId ? 'active' : ''}" data-chapter-id="${chapter.id}">
                  <span>${escapeHtml(chapter.title)}</span>
                  <small>${state.segments.filter((item) => item.chapterId === chapter.id && item.target).length}/${state.segments.filter((item) => item.chapterId === chapter.id).length}</small>
                </button>
              `).join('')}
            </div>
            <div class="novel-translator-segments">
              ${segments.map((segment) => `
                <button class="novel-translator-segment ${segment.id === state.activeSegmentId ? 'active' : ''}" data-segment-id="${segment.id}">
                  <span>${escapeHtml(segment.source.slice(0, 80))}</span>
                  <small>${escapeHtml(segment.status)}</small>
                </button>
              `).join('')}
            </div>
          </section>

          <section class="novel-translator-pane novel-translator-editor">
            <div class="novel-translator-split-header">
              <b>Segment</b>
              <span>${activeChapter ? escapeHtml(activeChapter.title) : 'No chapter'}</span>
            </div>
            <label>Source</label>
            <textarea id="nt_segment_source" class="text_pole textarea_compact" rows="8" readonly>${escapeHtml(activeSegment?.source ?? '')}</textarea>
            <label>Translation</label>
            <textarea id="nt_segment_target" class="text_pole textarea_compact" rows="8" placeholder="Write or paste the translation here">${escapeHtml(activeSegment?.target ?? '')}</textarea>
            <label>Translator notes</label>
            <textarea id="nt_segment_notes" class="text_pole textarea_compact" rows="3" placeholder="Optional notes">${escapeHtml(activeSegment?.notes ?? '')}</textarea>
            <div class="novel-translator-actions">
              <button id="nt_save_segment_btn" class="menu_button">Save segment</button>
              <button id="nt_prompt_btn" class="menu_button">Build prompt</button>
              <button id="nt_review_prompt_btn" class="menu_button">Review prompt</button>
            </div>
            <textarea id="nt_prompt_output" class="text_pole textarea_compact" rows="7" placeholder="Generated prompt"></textarea>
            <div class="novel-translator-actions">
              <button id="nt_copy_prompt_btn" class="menu_button">Copy prompt</button>
              <button id="nt_send_prompt_btn" class="menu_button">Send to chat</button>
            </div>
          </section>

          <section class="novel-translator-pane novel-translator-memory">
            <div class="novel-translator-tabs">
              <button class="menu_button nt-tab active" data-tab="glossary">Glossary</button>
              <button class="menu_button nt-tab" data-tab="entities">Names</button>
              <button class="menu_button nt-tab" data-tab="style">Style</button>
              <button class="menu_button nt-tab" data-tab="qa">QA</button>
            </div>
            <div id="nt_memory_panel">
              ${renderMemoryPanel('glossary')}
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderMemoryPanel(tab) {
  if (tab === 'entities') {
    return `
      <div class="novel-translator-table">
        ${state.entities.map((item) => `
          <div class="novel-translator-memory-row">
            <input class="text_pole nt-entity-source" data-id="${item.id}" value="${escapeHtml(item.sourceName)}" placeholder="Original name">
            <input class="text_pole nt-entity-target" data-id="${item.id}" value="${escapeHtml(item.translatedName)}" placeholder="Translated name">
            <input class="text_pole nt-entity-role" data-id="${item.id}" value="${escapeHtml(item.role)}" placeholder="Role">
          </div>
        `).join('')}
      </div>
      <button id="nt_add_entity_btn" class="menu_button wide100p">Add name</button>
    `;
  }

  if (tab === 'style') {
    return `
      <div class="novel-translator-table">
        ${state.styleRules.map((item) => `
          <div class="novel-translator-memory-row">
            <input class="text_pole nt-style-rule" data-id="${item.id}" value="${escapeHtml(item.rule)}" placeholder="Style rule">
            <input class="text_pole nt-style-example" data-id="${item.id}" value="${escapeHtml(item.examples)}" placeholder="Examples">
          </div>
        `).join('')}
      </div>
      <button id="nt_add_style_btn" class="menu_button wide100p">Add style rule</button>
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
        `).join('') : '<div class="novel-translator-empty">No QA issues yet.</div>'}
      </div>
    `;
  }

  return `
    <div class="novel-translator-table">
      ${state.glossary.map((item) => `
        <div class="novel-translator-memory-row">
          <input class="text_pole nt-glossary-source" data-id="${item.id}" value="${escapeHtml(item.sourceTerm)}" placeholder="Source term">
          <input class="text_pole nt-glossary-target" data-id="${item.id}" value="${escapeHtml(item.targetTerm)}" placeholder="Target term">
          <input class="text_pole nt-glossary-type" data-id="${item.id}" value="${escapeHtml(item.type)}" placeholder="Type">
        </div>
      `).join('')}
    </div>
    <button id="nt_add_glossary_btn" class="menu_button wide100p">Add glossary term</button>
  `;
}

function bindEvents() {
  root.querySelector('#nt_save_project')?.addEventListener('click', () => {
    dispatch({
      type: 'updateProject',
      patch: {
        title: getTextAreaValue('nt_project_title') || 'Untitled novel',
        sourceLang: getTextAreaValue('nt_source_lang') || 'Chinese',
        targetLang: getTextAreaValue('nt_target_lang') || 'English',
        styleProfile: getTextAreaValue('nt_style_profile'),
      },
    });
  });

  root.querySelector('#nt_import_text_btn')?.addEventListener('click', () => {
    const text = getTextAreaValue('nt_import_text');
    if (!text) {
      return;
    }
    const parsed = splitNovelText(text);
    dispatch({ type: 'replaceNovelContent', chapters: parsed.chapters, segments: parsed.segments });
  });

  root.querySelector('#nt_export_json_btn')?.addEventListener('click', async () => {
    const json = exportState(state);
    await navigator.clipboard?.writeText(json);
    setTextAreaValue('nt_import_json', json);
  });

  root.querySelector('#nt_import_json_btn')?.addEventListener('click', () => {
    const json = getTextAreaValue('nt_import_json');
    if (!json) {
      return;
    }
    dispatch({ type: 'replaceState', state: importState(json) });
  });

  root.querySelectorAll('.novel-translator-chapter').forEach((button) => {
    button.addEventListener('click', () => dispatch({ type: 'setActiveChapter', chapterId: button.dataset.chapterId }));
  });

  root.querySelectorAll('.novel-translator-segment').forEach((button) => {
    button.addEventListener('click', () => dispatch({ type: 'setActiveSegment', segmentId: button.dataset.segmentId }));
  });

  root.querySelector('#nt_save_segment_btn')?.addEventListener('click', () => {
    const segment = selectActiveSegment(state);
    if (!segment) {
      return;
    }
    dispatch({
      type: 'updateSegment',
      segmentId: segment.id,
      patch: {
        target: getTextAreaValue('nt_segment_target'),
        notes: getTextAreaValue('nt_segment_notes'),
        status: getTextAreaValue('nt_segment_target') ? 'translated' : 'draft',
      },
    });
  });

  root.querySelector('#nt_prompt_btn')?.addEventListener('click', () => {
    setTextAreaValue('nt_prompt_output', buildTranslationPrompt(state));
  });

  root.querySelector('#nt_review_prompt_btn')?.addEventListener('click', () => {
    setTextAreaValue('nt_prompt_output', buildReviewPrompt(state));
  });

  root.querySelector('#nt_copy_prompt_btn')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(getTextAreaValue('nt_prompt_output'));
  });

  root.querySelector('#nt_send_prompt_btn')?.addEventListener('click', () => {
    sendPromptToChat(getTextAreaValue('nt_prompt_output'));
  });

  root.querySelector('#nt_run_qa_btn')?.addEventListener('click', () => {
    dispatch({ type: 'setQaIssues', issues: runProjectQa(state) });
  });

  root.querySelectorAll('.nt-tab').forEach((button) => {
    button.addEventListener('click', () => {
      root.querySelectorAll('.nt-tab').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const panel = root.querySelector('#nt_memory_panel');
      panel.innerHTML = renderMemoryPanel(button.dataset.tab);
      bindMemoryEvents();
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
