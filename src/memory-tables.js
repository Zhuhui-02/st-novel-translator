export const MEMORY_TABLES = [
  {
    key: 'spatiotemporal',
    title: '时空表',
    subjectLabel: '时间/地点',
    detailLabel: '状态',
    statusLabel: '阶段',
    prompt: 'Track time, location, travel state, scene position, and chronology constraints.',
  },
  {
    key: 'characterTraits',
    title: '角色特征表',
    subjectLabel: '角色',
    detailLabel: '特征',
    statusLabel: '稳定性',
    prompt: 'Track appearance, personality, ability, habits, speech style, wounds, secrets, and role facts.',
  },
  {
    key: 'protagonistRelations',
    title: '角色与主角社交表',
    subjectLabel: '角色',
    detailLabel: '与主角关系',
    statusLabel: '态度',
    prompt: 'Track relationship to the protagonist, trust, hostility, obligations, affection, debt, and social distance.',
  },
  {
    key: 'tasksAgreements',
    title: '任务/命令/约定表',
    subjectLabel: '任务/约定',
    detailLabel: '内容',
    statusLabel: '状态',
    prompt: 'Track quests, orders, promises, contracts, rules, taboos, deadlines, and unresolved obligations.',
  },
  {
    key: 'eventHistory',
    title: '重要事件历史表',
    subjectLabel: '事件',
    detailLabel: '影响',
    statusLabel: '时间线',
    prompt: 'Track important events, causes, consequences, revealed facts, reversals, and continuity anchors.',
  },
  {
    key: 'importantItems',
    title: '重要物品表',
    subjectLabel: '物品',
    detailLabel: '属性/用途',
    statusLabel: '持有/状态',
    prompt: 'Track important objects, ownership, location, condition, powers, limitations, and promised uses.',
  },
];

export function createDefaultMemoryTables() {
  return Object.fromEntries(MEMORY_TABLES.map((table) => [table.key, []]));
}

export function normalizeMemoryTables(candidate) {
  const fallback = createDefaultMemoryTables();
  if (!candidate || typeof candidate !== 'object') {
    return fallback;
  }

  return Object.fromEntries(MEMORY_TABLES.map((table) => [
    table.key,
    Array.isArray(candidate[table.key]) ? candidate[table.key].map((entry) => normalizeEntry(entry, table.key)) : [],
  ]));
}

export function createMemoryEntry(tableKey, patch = {}) {
  return normalizeEntry({
    id: createMemoryId(tableKey),
    subject: '',
    detail: '',
    status: '',
    evidence: '',
    confidence: 'medium',
    updatedAt: new Date().toISOString(),
    ...patch,
  }, tableKey);
}

export function applyMemoryUpdates(memoryTables, payload, context = {}) {
  const next = normalizeMemoryTables(memoryTables);
  const updates = normalizePayload(payload);

  for (const table of MEMORY_TABLES) {
    const incoming = Array.isArray(updates[table.key]) ? updates[table.key] : [];
    for (const raw of incoming) {
      const entry = createMemoryEntry(table.key, {
        subject: raw.subject ?? raw.name ?? raw.item ?? raw.event ?? raw.topic ?? '',
        detail: raw.detail ?? raw.content ?? raw.description ?? raw.trait ?? raw.impact ?? '',
        status: raw.status ?? raw.phase ?? raw.attitude ?? raw.owner ?? '',
        evidence: raw.evidence ?? raw.source ?? context.evidence ?? '',
        confidence: raw.confidence ?? 'medium',
        chapterId: raw.chapterId ?? context.chapterId ?? '',
        segmentId: raw.segmentId ?? context.segmentId ?? '',
      });

      if (!entry.subject && !entry.detail) {
        continue;
      }

      const existingIndex = findExistingIndex(next[table.key], entry);
      if (existingIndex >= 0) {
        next[table.key][existingIndex] = mergeEntry(next[table.key][existingIndex], entry);
      } else {
        next[table.key].push(entry);
      }
    }
  }

  return next;
}

export function formatMemoryContext(memoryTables, limitPerTable = 8) {
  const normalized = normalizeMemoryTables(memoryTables);
  const sections = [];

  for (const table of MEMORY_TABLES) {
    const rows = normalized[table.key]
      .filter((entry) => entry.subject || entry.detail)
      .slice(-limitPerTable)
      .map((entry) => {
        const status = entry.status ? ` | ${table.statusLabel}: ${entry.status}` : '';
        const evidence = entry.evidence ? ` | Evidence: ${entry.evidence}` : '';
        return `- ${table.subjectLabel}: ${entry.subject}; ${table.detailLabel}: ${entry.detail}${status}${evidence}`;
      });
    if (rows.length) {
      sections.push(`${table.title}:\n${rows.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

export function buildMemoryUpdateInstructions() {
  const schema = Object.fromEntries(MEMORY_TABLES.map((table) => [
    table.key,
    [{ subject: '', detail: '', status: '', evidence: '', confidence: 'low|medium|high' }],
  ]));

  return [
    'Memory update protocol:',
    '- While translating, extract only stable facts that help future translation continuity.',
    '- Do not invent facts. Do not infer beyond the source passage and nearby context.',
    '- If a fact changes, add the newest state with clear evidence instead of deleting history.',
    '- Keep entries concise; evidence should quote or paraphrase the source anchor briefly.',
    '',
    'Tables to maintain:',
    ...MEMORY_TABLES.map((table) => `- ${table.title}: ${table.prompt}`),
    '',
    'Return strict JSON only. Shape:',
    JSON.stringify({
      translation: '',
      memory_updates: schema,
    }, null, 2),
  ].join('\n');
}

export function getMemoryTable(tableKey) {
  return MEMORY_TABLES.find((table) => table.key === tableKey) ?? MEMORY_TABLES[0];
}

function normalizePayload(payload) {
  if (!payload) {
    return {};
  }
  if (typeof payload === 'string') {
    try {
      return normalizePayload(JSON.parse(payload));
    } catch {
      return {};
    }
  }
  if (payload.memory_updates && typeof payload.memory_updates === 'object') {
    return payload.memory_updates;
  }
  return payload;
}

function normalizeEntry(entry, tableKey) {
  return {
    id: entry?.id || createMemoryId(tableKey),
    subject: String(entry?.subject ?? '').trim(),
    detail: String(entry?.detail ?? '').trim(),
    status: String(entry?.status ?? '').trim(),
    evidence: String(entry?.evidence ?? '').trim(),
    confidence: String(entry?.confidence ?? 'medium').trim(),
    chapterId: String(entry?.chapterId ?? '').trim(),
    segmentId: String(entry?.segmentId ?? '').trim(),
    updatedAt: entry?.updatedAt || new Date().toISOString(),
  };
}

function findExistingIndex(rows, incoming) {
  const subject = incoming.subject.toLowerCase();
  const detail = incoming.detail.toLowerCase();
  return rows.findIndex((row) => {
    if (!row.subject) {
      return false;
    }
    const sameSubject = row.subject.toLowerCase() === subject;
    const sameDetail = row.detail.toLowerCase() === detail;
    return sameSubject && (sameDetail || !detail || !row.detail);
  });
}

function mergeEntry(existing, incoming) {
  return {
    ...existing,
    detail: incoming.detail || existing.detail,
    status: incoming.status || existing.status,
    evidence: incoming.evidence || existing.evidence,
    confidence: incoming.confidence || existing.confidence,
    chapterId: incoming.chapterId || existing.chapterId,
    segmentId: incoming.segmentId || existing.segmentId,
    updatedAt: new Date().toISOString(),
  };
}

function createMemoryId(tableKey) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${tableKey}_${Date.now().toString(36)}_${random}`;
}
