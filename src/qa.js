export function runProjectQa(state) {
  const issues = [];

  for (const segment of state.segments) {
    if (!segment.target?.trim()) {
      issues.push(createIssue(segment.id, 'empty_translation', 'high', 'Segment has no translation.'));
      continue;
    }

    const sourceLength = segment.source.length;
    const targetLength = segment.target.length;
    if (sourceLength > 80 && targetLength < sourceLength * 0.25) {
      issues.push(createIssue(segment.id, 'possible_omission', 'medium', 'Translation is much shorter than the source.'));
    }
    if (sourceLength > 80 && targetLength > sourceLength * 3.5) {
      issues.push(createIssue(segment.id, 'possible_expansion', 'medium', 'Translation is much longer than the source.'));
    }

    for (const term of state.glossary) {
      if (!term.sourceTerm || !term.targetTerm) {
        continue;
      }
      if (segment.source.includes(term.sourceTerm) && !segment.target.includes(term.targetTerm)) {
        issues.push(createIssue(
          segment.id,
          'glossary_mismatch',
          'medium',
          `Expected glossary translation "${term.targetTerm}" for "${term.sourceTerm}".`,
        ));
      }
    }

    for (const entity of state.entities) {
      if (!entity.sourceName || !entity.translatedName) {
        continue;
      }
      if (segment.source.includes(entity.sourceName) && !segment.target.includes(entity.translatedName)) {
        issues.push(createIssue(
          segment.id,
          'name_mismatch',
          'medium',
          `Expected name translation "${entity.translatedName}" for "${entity.sourceName}".`,
        ));
      }
    }
  }

  return issues;
}

function createIssue(segmentId, type, severity, message) {
  return {
    id: `${segmentId}_${type}`,
    segmentId,
    type,
    severity,
    message,
    resolved: false,
    createdAt: new Date().toISOString(),
  };
}
