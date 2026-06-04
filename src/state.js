import { applyMemoryUpdates, createDefaultMemoryTables, createMemoryEntry, normalizeMemoryTables } from './memory-tables.js';

const DEFAULT_PROJECT_ID = 'project_default';

export function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function createDefaultState() {
  return {
    version: 1,
    project: {
      id: DEFAULT_PROJECT_ID,
      title: 'Untitled novel',
      sourceLang: 'Chinese',
      targetLang: 'English',
      styleProfile: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activeChapterId: null,
    activeSegmentId: null,
    chapters: [],
    segments: [],
    glossary: [],
    entities: [],
    styleRules: [],
    memoryTables: createDefaultMemoryTables(),
    qaIssues: [],
  };
}

export function normalizeState(candidate) {
  const fallback = createDefaultState();
  if (!candidate || typeof candidate !== 'object') {
    return fallback;
  }

  const state = {
    ...fallback,
    ...candidate,
    project: { ...fallback.project, ...(candidate.project ?? {}) },
    chapters: Array.isArray(candidate.chapters) ? candidate.chapters : [],
    segments: Array.isArray(candidate.segments) ? candidate.segments : [],
    glossary: Array.isArray(candidate.glossary) ? candidate.glossary : [],
    entities: Array.isArray(candidate.entities) ? candidate.entities : [],
    styleRules: Array.isArray(candidate.styleRules) ? candidate.styleRules : [],
    memoryTables: normalizeMemoryTables(candidate.memoryTables),
    qaIssues: Array.isArray(candidate.qaIssues) ? candidate.qaIssues : [],
  };

  if (!state.activeChapterId && state.chapters[0]) {
    state.activeChapterId = state.chapters[0].id;
  }
  if (!state.activeSegmentId) {
    const firstSegment = state.segments.find((item) => item.chapterId === state.activeChapterId) ?? state.segments[0];
    state.activeSegmentId = firstSegment?.id ?? null;
  }

  return state;
}

export function selectActiveChapter(state) {
  return state.chapters.find((item) => item.id === state.activeChapterId) ?? state.chapters[0] ?? null;
}

export function selectActiveSegment(state) {
  return state.segments.find((item) => item.id === state.activeSegmentId) ?? null;
}

export function reduceState(state, action) {
  switch (action.type) {
    case 'replaceState':
      return normalizeState(action.state);

    case 'updateProject':
      return touch({
        ...state,
        project: { ...state.project, ...action.patch },
      });

    case 'replaceNovelContent': {
      const activeChapterId = action.chapters[0]?.id ?? null;
      const activeSegmentId = action.segments.find((item) => item.chapterId === activeChapterId)?.id ?? null;
      return touch({
        ...state,
        chapters: action.chapters,
        segments: action.segments,
        activeChapterId,
        activeSegmentId,
        qaIssues: [],
      });
    }

    case 'setActiveChapter': {
      const activeSegmentId = state.segments.find((item) => item.chapterId === action.chapterId)?.id ?? null;
      return { ...state, activeChapterId: action.chapterId, activeSegmentId };
    }

    case 'setActiveSegment':
      return { ...state, activeSegmentId: action.segmentId };

    case 'updateSegment':
      return touch({
        ...state,
        segments: state.segments.map((item) => item.id === action.segmentId ? { ...item, ...action.patch, updatedAt: new Date().toISOString() } : item),
      });

    case 'addGlossaryEntry':
      return touch({
        ...state,
        glossary: [...state.glossary, {
          id: createId('term'),
          sourceTerm: '',
          targetTerm: '',
          type: 'term',
          priority: 50,
          note: '',
        }],
      });

    case 'updateGlossaryEntry':
      return touch({
        ...state,
        glossary: state.glossary.map((item) => item.id === action.id ? { ...item, ...action.patch } : item),
      });

    case 'addEntity':
      return touch({
        ...state,
        entities: [...state.entities, {
          id: createId('entity'),
          sourceName: '',
          translatedName: '',
          aliases: '',
          role: '',
          speechStyle: '',
          notes: '',
        }],
      });

    case 'updateEntity':
      return touch({
        ...state,
        entities: state.entities.map((item) => item.id === action.id ? { ...item, ...action.patch } : item),
      });

    case 'addStyleRule':
      return touch({
        ...state,
        styleRules: [...state.styleRules, {
          id: createId('style'),
          rule: '',
          examples: '',
          priority: 50,
        }],
      });

    case 'updateStyleRule':
      return touch({
        ...state,
        styleRules: state.styleRules.map((item) => item.id === action.id ? { ...item, ...action.patch } : item),
      });

    case 'addMemoryEntry':
      return touch({
        ...state,
        memoryTables: {
          ...state.memoryTables,
          [action.table]: [...(state.memoryTables[action.table] ?? []), createMemoryEntry(action.table)],
        },
      });

    case 'updateMemoryEntry':
      return touch({
        ...state,
        memoryTables: {
          ...state.memoryTables,
          [action.table]: (state.memoryTables[action.table] ?? []).map((item) => (
            item.id === action.id ? { ...item, ...action.patch, updatedAt: new Date().toISOString() } : item
          )),
        },
      });

    case 'applyMemoryUpdates':
      return touch({
        ...state,
        memoryTables: applyMemoryUpdates(state.memoryTables, action.payload, {
          chapterId: action.chapterId,
          segmentId: action.segmentId,
          evidence: action.evidence,
        }),
      });

    case 'setQaIssues':
      return { ...state, qaIssues: action.issues };

    default:
      return state;
  }
}

export function exportState(state) {
  return JSON.stringify(touch(state), null, 2);
}

export function importState(json) {
  return normalizeState(JSON.parse(json));
}

function touch(state) {
  return {
    ...state,
    project: {
      ...state.project,
      updatedAt: new Date().toISOString(),
    },
  };
}
