export interface ParsedSection {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  startOffset: number;
  endOffset: number;
  text: string;
  contentStartOffset?: number;
}

export interface ParsedChunk {
  id: string;
  sectionId: string;
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

interface Heading {
  title: string;
  level: number;
}

function parseHeading(line: string): Heading | null {
  const markdown = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (markdown) {
    return {level: markdown[1].length, title: markdown[2].trim()};
  }

  const chinese = /^第\s*([一二三四五六七八九十百千万零〇0-9]+)\s*([章节篇部卷])\s*(.+?)\s*$/.exec(line);
  if (chinese) {
    return {level: chinese[2] === '节' ? 2 : 1, title: line.trim()};
  }

  const english = /^(chapter|section)\s+(\d+(?:\.\d+)*)\b[-.、:：\s]*(.*?)\s*$/i.exec(line);
  if (english) {
    const level = english[1].toLowerCase() === 'section' ? 2 : english[2].split('.').length;
    return {level, title: line.trim()};
  }

  const numbered = /^(\d+(?:\.\d+)+)\s*[-.、:：]?\s+(.+?)\s*$/.exec(line);
  if (numbered) {
    return {level: numbered[1].split('.').length, title: line.trim()};
  }

  const chapterNumber = /^(\d+)[.、]\s+(.+?)\s*$/.exec(line);
  return chapterNumber ? {level: 1, title: line.trim()} : null;
}

function trimBody(text: string, offset: number): {text: string; contentStartOffset: number} {
  const leadingWhitespace = /^\s*/.exec(text)?.[0].length ?? 0;
  return {
    text: text.trim(),
    contentStartOffset: offset + leadingWhitespace,
  };
}

export function parseOutline(text: string): ParsedSection[] {
  const headings: Array<Heading & {startOffset: number; lineEndOffset: number}> = [];
  let startOffset = 0;

  for (const line of text.split(/(?<=\n)/)) {
    const lineWithoutNewline = line.replace(/\r?\n$/, '');
    const heading = parseHeading(lineWithoutNewline);
    if (heading) {
      headings.push({...heading, startOffset, lineEndOffset: startOffset + line.length});
    }
    startOffset += line.length;
  }

  if (headings.length === 0) {
    const body = trimBody(text, 0);
    return [
      {
        id: 'section-1',
        title: 'Document',
        level: 1,
        parentId: null,
        startOffset: 0,
        endOffset: text.length,
        text: body.text,
        contentStartOffset: body.contentStartOffset,
      },
    ];
  }

  const stack: ParsedSection[] = [];
  return headings.map((heading, index) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    const bodyEndOffset = headings[index + 1]?.startOffset ?? text.length;
    const body = trimBody(text.slice(heading.lineEndOffset, bodyEndOffset), heading.lineEndOffset);
    const section: ParsedSection = {
      id: `section-${index + 1}`,
      title: heading.title,
      level: heading.level,
      parentId: stack[stack.length - 1]?.id ?? null,
      startOffset: heading.startOffset,
      endOffset: bodyEndOffset,
      text: body.text,
      contentStartOffset: body.contentStartOffset,
    };
    stack.push(section);
    return section;
  });
}

function chunksForParagraph(text: string, startOffset: number, maxChars: number): Array<{text: string; startOffset: number}> {
  const chunks: Array<{text: string; startOffset: number}> = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push({text: text.slice(index, index + maxChars), startOffset: startOffset + index});
  }
  return chunks;
}

export function splitOversizedSection(section: ParsedSection, maxChars = 6000): ParsedChunk[] {
  if (maxChars <= 0) {
    throw new Error('maxChars must be positive');
  }

  const baseOffset = section.contentStartOffset ?? section.startOffset;
  if (section.text.length <= maxChars) {
    return [
      {
        id: `${section.id}-chunk-0`,
        sectionId: section.id,
        index: 0,
        text: section.text,
        startOffset: baseOffset,
        endOffset: baseOffset + section.text.length,
      },
    ];
  }

  const paragraphs: Array<{text: string; startOffset: number}> = [];
  const paragraphBoundary = /\n[\t ]*\n+/g;
  let paragraphStart = 0;
  let boundary: RegExpExecArray | null;
  while ((boundary = paragraphBoundary.exec(section.text)) !== null) {
    const paragraph = section.text.slice(paragraphStart, boundary.index);
    if (paragraph) {
      paragraphs.push({text: paragraph, startOffset: paragraphStart});
    }
    paragraphStart = boundary.index + boundary[0].length;
  }
  const finalParagraph = section.text.slice(paragraphStart);
  if (finalParagraph) {
    paragraphs.push({text: finalParagraph, startOffset: paragraphStart});
  }

  const chunks: Array<{text: string; startOffset: number}> = [];
  let current: {text: string; startOffset: number} | null = null;
  for (const paragraph of paragraphs) {
    if (paragraph.text.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = null;
      }
      chunks.push(...chunksForParagraph(paragraph.text, paragraph.startOffset, maxChars));
      continue;
    }
    if (!current) {
      current = paragraph;
      continue;
    }
    const combinedEnd = paragraph.startOffset + paragraph.text.length;
    const combined = section.text.slice(current.startOffset, combinedEnd);
    if (combined.length <= maxChars) {
      current = {text: combined, startOffset: current.startOffset};
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) {
    chunks.push(current);
  }

  return chunks.map((chunk, index) => ({
    id: `${section.id}-chunk-${index}`,
    sectionId: section.id,
    index,
    text: chunk.text,
    startOffset: baseOffset + chunk.startOffset,
    endOffset: baseOffset + chunk.startOffset + chunk.text.length,
  }));
}
