import type {ConceptCard, OutlineNode} from '../../domain/models';

type PromptModule = {
  buildGenerationMessages: (node: OutlineNode) => Array<{role: string; content: string}>;
  buildChatMessages: (card: ConceptCard, question: string) => Array<{role: string; content: string}>;
};

function loadPrompts(): PromptModule {
  return require('../prompts') as PromptModule;
}

const node: OutlineNode = {
  id: 'section-1',
  bookId: 'book-1',
  parentId: null,
  title: '因果推断',
  level: 2,
  body: 'ONLY_BOUNDED_SECTION_BODY',
  childIds: [],
  status: 'queued',
  chunkIndex: 0,
  startOffset: 100,
  endOffset: 125,
};

const card: ConceptCard = {
  id: 'card-1',
  bookId: 'book-1',
  sectionId: node.id,
  cardType: 'concept',
  chapter: '因果推断',
  title: '反事实',
  sourceText: 'CARD_SOURCE_ONLY',
  oneSentence: '反事实比较可能结果。',
  simpleExplanation: '解释内容。',
  fable: '寓言内容。',
  formula: '$Y(1)-Y(0)$',
  formulaExplanation: '$Y(1)$ 和 $Y(0)$ 是潜在结果。',
  prerequisites: [],
  relatedConcepts: [],
  questions: ['为什么？', '怎么做？', '然后呢？'],
  isFavorite: false,
  createdAt: '2026-07-16T00:00:00.000Z',
};

describe('DeepSeek prompts', () => {
  it('sends exactly one complete bounded section with strict card requirements', () => {
    let prompts: PromptModule | undefined;
    expect(() => {
      prompts = loadPrompts();
    }).not.toThrow();

    const messages = prompts!.buildGenerationMessages(node);
    const prompt = messages.map(message => message.content).join('\n');

    expect(prompt.match(/ONLY_BOUNDED_SECTION_BODY/g)).toHaveLength(1);
    expect(prompt).toContain(node.title);
    expect(prompt).toContain('section_overview');
    expect(prompt).toContain('250-450');
    expect(prompt).toContain('exactly three');
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('strict JSON');
    expect(prompt).toContain('no Markdown');
  });

  it('binds chat to only the selected card and requires readable LaTeX answers', () => {
    const prompt = loadPrompts().buildChatMessages(card, '如何理解这个公式？')
      .map(message => message.content)
      .join('\n');

    expect(prompt).toContain(card.sourceText);
    expect(prompt).toContain(card.chapter);
    expect(prompt).toContain(card.simpleExplanation);
    expect(prompt).toContain(card.formula);
    expect(prompt).toContain('如何理解这个公式？');
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('paragraph');
    expect(prompt).toContain('Do not use unrelated book text');
  });
});
