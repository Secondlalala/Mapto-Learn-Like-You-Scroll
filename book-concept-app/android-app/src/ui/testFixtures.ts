import type {Book, ConceptCard, OutlineNode} from '../domain/models';

export const book: Book = {
  id: 'book-1', title: '量子场论讲义', author: null, sourceUri: 'file:///book.md',
  originalText: '# 第一章', tags: [], createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
};

export const outline: OutlineNode[] = [
  {id: 'section-1', bookId: book.id, parentId: null, title: '第一章 为什么需要场', level: 1, body: '章节正文', childIds: ['section-2'], status: 'completed', chunkIndex: 1, startOffset: 0, endOffset: 100},
  {id: 'section-2', bookId: book.id, parentId: 'section-1', title: '1.1 经典场', level: 2, body: '小节正文', childIds: [], status: 'queued', chunkIndex: 0, startOffset: 20, endOffset: 100},
];

export const cards: ConceptCard[] = ['card-1', 'card-2', 'card-3'].map((id, index) => ({
  id, bookId: book.id, sectionId: index < 2 ? 'section-1' : 'section-2',
  cardType: index === 0 ? 'section_overview' : 'concept', chapter: '第一章',
  title: index === 0 ? '本章导览' : `概念 ${index}`, sourceText: '原文片段', oneSentence: '一句话解释',
  simpleExplanation: '通俗解释', fable: '寓言故事', formula: '$E=mc^2$', formulaExplanation: '公式说明',
  prerequisites: ['经典力学'], relatedConcepts: ['量子力学'], questions: ['为什么需要场？'],
  isFavorite: false, createdAt: `2026-07-16T00:00:0${index}.000Z`,
}));
