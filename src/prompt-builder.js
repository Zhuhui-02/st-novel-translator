import { selectActiveChapter, selectActiveSegment } from './state.js';

export function buildTranslationPrompt(state) {
  const segment = selectActiveSegment(state);
  const chapter = selectActiveChapter(state);
  if (!segment) {
    return '';
  }

  const context = buildNearbyContext(state, segment);
  const glossary = selectMatchingGlossary(state, segment.source);
  const entities = selectMatchingEntities(state, segment.source);
  const styleRules = state.styleRules.filter((item) => item.rule).sort(byPriority).slice(0, 12);

  return [
    `You are a professional literary translator translating a novel from ${state.project.sourceLang} to ${state.project.targetLang}.`,
    '',
    'Hard rules:',
    '- Translate only the source passage.',
    '- Preserve all factual content, chronology, dialogue intent, and paragraph breaks.',
    '- Do not summarize, continue the story, explain the translation, or add notes unless requested.',
    '- Keep names and terms consistent with the glossary and name table.',
    '',
    section('Project style profile', state.project.styleProfile),
    section('Chapter', chapter?.title ?? ''),
    listSection('Style rules', styleRules.map((item) => formatStyleRule(item))),
    listSection('Name table', entities.map((item) => `${item.sourceName} => ${item.translatedName}${item.role ? ` (${item.role})` : ''}`)),
    listSection('Glossary', glossary.map((item) => `${item.sourceTerm} => ${item.targetTerm}${item.type ? ` [${item.type}]` : ''}`)),
    section('Nearby context', context),
    section('Source passage', segment.source),
    '',
    `Return only the ${state.project.targetLang} translation.`,
  ].filter(Boolean).join('\n');
}

export function buildReviewPrompt(state) {
  const segment = selectActiveSegment(state);
  if (!segment) {
    return '';
  }

  const glossary = selectMatchingGlossary(state, `${segment.source}\n${segment.target}`);
  const entities = selectMatchingEntities(state, `${segment.source}\n${segment.target}`);

  return [
    `You are reviewing a ${state.project.sourceLang} to ${state.project.targetLang} literary translation.`,
    '',
    'Check for:',
    '- omissions or hallucinated additions',
    '- inconsistent names, titles, and terminology',
    '- broken dialogue tone or register',
    '- mistranslated subject/object relationships',
    '- formatting drift',
    '',
    listSection('Expected names', entities.map((item) => `${item.sourceName} => ${item.translatedName}`)),
    listSection('Expected glossary', glossary.map((item) => `${item.sourceTerm} => ${item.targetTerm}`)),
    section('Source passage', segment.source),
    section('Translation', segment.target),
    '',
    'Return concise JSON:',
    '{"status":"pass|needs_revision","issues":[{"type":"","severity":"low|medium|high","message":"","suggestion":""}]}',
  ].filter(Boolean).join('\n');
}

function buildNearbyContext(state, activeSegment) {
  const siblings = state.segments.filter((item) => item.chapterId === activeSegment.chapterId);
  const index = siblings.findIndex((item) => item.id === activeSegment.id);
  const before = siblings.slice(Math.max(index - 3, 0), index);
  const after = siblings.slice(index + 1, index + 3);
  const rows = [
    ...before.map((item) => formatContextRow('Previous', item)),
    ...after.map((item) => formatContextRow('Following source', item, false)),
  ];
  return rows.join('\n\n');
}

function formatContextRow(label, segment, includeTarget = true) {
  if (includeTarget && segment.target) {
    return `${label} source:\n${segment.source}\n${label} translation:\n${segment.target}`;
  }
  return `${label}:\n${segment.source}`;
}

function selectMatchingGlossary(state, text) {
  return state.glossary
    .filter((item) => item.sourceTerm && item.targetTerm)
    .filter((item) => text.includes(item.sourceTerm))
    .sort(byPriority)
    .slice(0, 30);
}

function selectMatchingEntities(state, text) {
  return state.entities
    .filter((item) => item.sourceName && item.translatedName)
    .filter((item) => {
      const aliases = String(item.aliases ?? '').split(/[,\n，、]/).map((value) => value.trim()).filter(Boolean);
      return text.includes(item.sourceName) || aliases.some((alias) => text.includes(alias));
    })
    .sort(byPriority)
    .slice(0, 30);
}

function listSection(title, rows) {
  if (!rows.length) {
    return '';
  }
  return [`${title}:`, ...rows.map((row) => `- ${row}`), ''].join('\n');
}

function section(title, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  return `${title}:\n${trimmed}\n`;
}

function formatStyleRule(rule) {
  return rule.examples ? `${rule.rule} Example: ${rule.examples}` : rule.rule;
}

function byPriority(a, b) {
  return (b.priority ?? 50) - (a.priority ?? 50);
}
