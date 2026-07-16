type GeneratedCard = {
  cardType: 'section_overview' | 'concept';
  chapter: string;
  title: string;
  sourceText: string;
  oneSentence: string;
  simpleExplanation: string;
  fable: string;
  formula: string;
  formulaExplanation: string;
  prerequisites: string[];
  relatedConcepts: string[];
  questions: string[];
};

type CardSchemaModule = {
  parseGeneratedCards: (content: string) => GeneratedCard[];
};

function loadSchema(): CardSchemaModule {
  return require('../cardSchema') as CardSchemaModule;
}

function validCard(cardType: GeneratedCard['cardType'], title: string): GeneratedCard {
  return {
    cardType,
    chapter: '第一章',
    title,
    sourceText: '这一节的完整有界原文。',
    oneSentence: '一句话说明这个概念。',
    simpleExplanation: '这是清楚且完整的解释。',
    fable: '这是一个细节充分、能够帮助读者理解因果关系的寓言。',
    formula: '$x=y$',
    formulaExplanation: '$x$ 表示输入，$y$ 表示输出。',
    prerequisites: ['基础概念'],
    relatedConcepts: ['后续概念'],
    questions: ['为什么需要它？', '它如何工作？', '下一步是什么？'],
  };
}

describe('generated card schema', () => {
  it('accepts one overview followed by a coherent concept sequence', () => {
    let schema: CardSchemaModule | undefined;
    expect(() => {
      schema = loadSchema();
    }).not.toThrow();

    const cards = [validCard('section_overview', '全节导览'), validCard('concept', '核心概念')];
    expect(schema!.parseGeneratedCards(JSON.stringify(cards))).toEqual(cards);
  });

  it.each([
    ['empty array', []],
    ['more than twenty cards', Array.from({length: 21}, (_, index) => validCard(index === 0 ? 'section_overview' : 'concept', `Card ${index}`))],
    ['overview outside position zero', [validCard('concept', 'Concept'), validCard('section_overview', 'Overview')]],
    ['unknown card type', [{...validCard('section_overview', 'Overview'), cardType: 'reference'}]],
    ['non-string array', [{...validCard('section_overview', 'Overview'), prerequisites: [1]}]],
    ['wrong question count', [{...validCard('section_overview', 'Overview'), questions: ['One?', 'Two?']}]],
    ['malformed formula delimiter', [{...validCard('section_overview', 'Overview'), formula: '$x=y'}]],
    ['Unicode formula substitute', [{...validCard('section_overview', 'Overview'), formula: '$x≤y$'}]],
    ['formula explanation without LaTeX notation', [{...validCard('section_overview', 'Overview'), formulaExplanation: 'x means input'}]],
  ])('rejects %s', (_label, cards) => {
    expect(() => loadSchema().parseGeneratedCards(JSON.stringify(cards))).toThrow(
      expect.objectContaining({name: 'DeepSeekSchemaError', retryable: true}),
    );
  });

  it.each(['not json', '```json\n[]\n```', JSON.stringify({cards: [validCard('section_overview', 'Overview')]})])(
    'rejects non-strict JSON arrays: %s',
    content => {
      expect(() => loadSchema().parseGeneratedCards(content)).toThrow(
        expect.objectContaining({name: 'DeepSeekSchemaError', retryable: true}),
      );
    },
  );
});
