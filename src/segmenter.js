import { createId } from './state.js';

const CHAPTER_PATTERNS = [
  /^第[零一二三四五六七八九十百千万\d]+[章节回卷部集].*$/u,
  /^chapter\s+\d+.*$/iu,
  /^ch\.\s*\d+.*$/iu,
  /^#{1,3}\s+.+$/,
];

export function splitNovelText(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return { chapters: [], segments: [] };
  }

  const blocks = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chapterGroups = [];
  let current = createChapterDraft('Chapter 1');

  for (const block of blocks) {
    const firstLine = block.split('\n')[0].trim();
    if (isChapterHeading(firstLine)) {
      if (current.blocks.length) {
        chapterGroups.push(current);
      }
      current = createChapterDraft(firstLine.replace(/^#{1,3}\s+/, ''));
      const rest = block.split('\n').slice(1).join('\n').trim();
      if (rest) {
        current.blocks.push(rest);
      }
      continue;
    }
    current.blocks.push(block);
  }

  if (current.blocks.length || !chapterGroups.length) {
    chapterGroups.push(current);
  }

  const chapters = [];
  const segments = [];

  chapterGroups.forEach((group, chapterIndex) => {
    const chapterId = createId('chapter');
    chapters.push({
      id: chapterId,
      title: group.title || `Chapter ${chapterIndex + 1}`,
      order: chapterIndex,
      status: 'draft',
    });

    group.blocks
      .flatMap((block) => splitBlockIntoSegments(block))
      .forEach((source, segmentIndex) => {
        segments.push({
          id: createId('segment'),
          chapterId,
          index: segmentIndex,
          source,
          target: '',
          status: 'draft',
          notes: '',
          sourceHash: hashText(source),
          updatedAt: new Date().toISOString(),
        });
      });
  });

  return { chapters, segments };
}

function createChapterDraft(title) {
  return { title, blocks: [] };
}

function isChapterHeading(line) {
  return CHAPTER_PATTERNS.some((pattern) => pattern.test(line));
}

function splitBlockIntoSegments(block) {
  const clean = block.replace(/\n+/g, '\n').trim();
  if (clean.length <= 900) {
    return [clean];
  }

  const sentences = clean.match(/[^。！？!?]+[。！？!?]?/gu) ?? [clean];
  const segments = [];
  let buffer = '';

  for (const sentence of sentences) {
    if ((buffer + sentence).length > 800 && buffer) {
      segments.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }

  if (buffer.trim()) {
    segments.push(buffer.trim());
  }

  return segments;
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
