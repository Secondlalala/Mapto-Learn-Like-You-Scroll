import {
  parseOutline,
  splitOversizedSection,
  type ParsedSection,
} from '../outlineParser';

describe('parseOutline', () => {
  it('keeps chapter and subsection hierarchy with source offsets', () => {
    const text = '# 第一章 导言\n开场\n## 1.1 背景\n正文';
    const result = parseOutline(text);

    expect(result.map(section => [section.level, section.title, section.parentId])).toEqual([
      [1, '第一章 导言', null],
      [2, '1.1 背景', 'section-1'],
    ]);
    expect(result[0]).toMatchObject({startOffset: 0, endOffset: text.indexOf('## 1.1 背景')});
    expect(result[1]).toMatchObject({startOffset: text.indexOf('## 1.1 背景'), endOffset: text.length});
  });

  it('recognizes numbered Chinese and English chapter and section headings', () => {
    const result = parseOutline('第2章 方法\n内容\n第1节 材料\n内容\nChapter 3 Results\n内容\n3.1 Analysis\n内容');

    expect(result.map(section => [section.level, section.title])).toEqual([
      [1, '第2章 方法'],
      [2, '第1节 材料'],
      [1, 'Chapter 3 Results'],
      [2, '3.1 Analysis'],
    ]);
    expect(result[1].parentId).toBe('section-1');
    expect(result[3].parentId).toBe('section-3');
  });

  it('preserves numeric depth for nested English Section headings', () => {
    const result = parseOutline('Section 3 Root\nBody\nSection 3.1 Child\nBody\nSection 3.1.1 Grandchild\nBody');

    expect(result.map(section => [section.level, section.parentId])).toEqual([
      [1, null],
      [2, 'section-1'],
      [3, 'section-2'],
    ]);
  });

  it('creates a zero-width document section for an empty file', () => {
    expect(parseOutline('')).toEqual([
      expect.objectContaining({
        startOffset: 0,
        endOffset: 0,
        contentStartOffset: 0,
        text: '',
      }),
    ]);
  });
});

describe('splitOversizedSection', () => {
  const section: ParsedSection = {
    id: 'section-1',
    title: 'Section',
    level: 1,
    parentId: null,
    startOffset: 0,
    endOffset: 13,
    text: '甲乙\n\n丙丁\n\n戊己',
  };

  it('splits long sections only at paragraph boundaries when possible', () => {
    const chunks = splitOversizedSection(section, 2);

    expect(chunks.map(chunk => chunk.text)).toEqual(['甲乙', '丙丁', '戊己']);
    expect(chunks.map(chunk => [chunk.startOffset, chunk.endOffset])).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ]);
  });

  it('enforces the size limit when one paragraph exceeds it', () => {
    const chunks = splitOversizedSection({...section, text: 'abcdef', endOffset: 6}, 3);

    expect(chunks.map(chunk => chunk.text)).toEqual(['abc', 'def']);
    expect(chunks.every(chunk => chunk.text.length <= 3)).toBe(true);
  });

  it('splits CRLF paragraphs without changing their source offsets', () => {
    const chunks = splitOversizedSection(
      {...section, text: 'aa\r\n\r\nbb\r\n\r\ncc', startOffset: 100, contentStartOffset: 100, endOffset: 114},
      2,
    );

    expect(chunks.map(chunk => [chunk.text, chunk.startOffset, chunk.endOffset])).toEqual([
      ['aa', 100, 102],
      ['bb', 106, 108],
      ['cc', 112, 114],
    ]);
  });
});
