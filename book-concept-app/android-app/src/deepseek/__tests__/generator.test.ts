import type {
  ChatMessage,
  ConceptCard,
  GenerationState,
  OutlineNode,
} from '../../domain/models';

type GenerationRepositories = {
  claimSectionForGeneration(
    sectionId: string,
    claimToken: string,
    updatedAt: string,
  ): Promise<{section: OutlineNode; previousCursor: number} | null>;
  listOutlineNodes(bookId: string): Promise<OutlineNode[]>;
  setGenerationState(state: GenerationState): Promise<void>;
  saveCardsAndAdvance(sectionId: string, cards: ConceptCard[], nextChunkIndex: number, updatedAt?: string): Promise<void>;
  getCard(cardId: string): Promise<ConceptCard | null>;
  insertMessage(message: ChatMessage): Promise<void>;
};

type GeneratorModule = {
  createDeepSeekGenerator: (dependencies: {
    repositories: GenerationRepositories;
    client: {complete: (messages: Array<{role: string; content: string}>) => Promise<string>};
    createId: () => string;
    createClaimToken: () => string;
    now: () => string;
  }) => {
    generateSection: (sectionId: string) => Promise<{sectionId: string; cards: ConceptCard[]}>;
    generateNextSection: (bookId: string, afterSectionId?: string) => Promise<{sectionId: string; cards: ConceptCard[]} | null>;
    askCard: (cardId: string, question: string) => Promise<ChatMessage>;
  };
};

function loadGenerator(): GeneratorModule {
  return require('../generator') as GeneratorModule;
}

const timestamp = '2026-07-16T08:00:00.000Z';

function node(id: string, startOffset: number, status: OutlineNode['status'] = 'queued'): OutlineNode {
  return {
    id,
    bookId: 'book-1',
    parentId: null,
    title: `Chapter ${id}`,
    level: 1,
    body: `FULL_BODY_${id}`,
    childIds: [],
    status,
    chunkIndex: 0,
    startOffset,
    endOffset: startOffset + 10,
  };
}

function generatedCard(cardType: 'section_overview' | 'concept', title: string) {
  return {
    cardType,
    chapter: 'Chapter section-a',
    title,
    sourceText: 'Bounded source excerpt',
    oneSentence: 'One sentence.',
    simpleExplanation: 'Simple explanation.',
    fable: 'A detailed and useful fable with enough causal detail.',
    formula: '$x=y$',
    formulaExplanation: '$x$ is input and $y$ is output.',
    prerequisites: ['prior'],
    relatedConcepts: ['next'],
    questions: ['Why?', 'How?', 'What follows?'],
  };
}

class MemoryRepositories {
  readonly nodes: OutlineNode[];
  readonly states = new Map<string, GenerationState>();
  readonly cards: ConceptCard[] = [];
  readonly messages: ChatMessage[] = [];
  readonly stateHistory: GenerationState[] = [];
  readonly saveCalls: Array<{sectionId: string; cards: ConceptCard[]; nextChunkIndex: number; updatedAt?: string}> = [];
  readonly events: string[] = [];

  constructor(nodes: OutlineNode[]) {
    this.nodes = nodes;
  }

  async getOutlineNode(sectionId: string) {
    return this.nodes.find(item => item.id === sectionId) ?? null;
  }

  async listOutlineNodes(bookId: string) {
    return this.nodes.filter(item => item.bookId === bookId);
  }

  async getGenerationState(sectionId: string) {
    return this.states.get(sectionId) ?? null;
  }

  async claimSectionForGeneration(sectionId: string, _claimToken: string, updatedAt: string) {
    const current = this.nodes.find(item => item.id === sectionId);
    if (!current || (current.status !== 'queued' && current.status !== 'failed')) {
      return null;
    }
    const previousCursor = this.states.get(sectionId)?.nextChunkIndex ?? current.chunkIndex;
    current.status = 'generating';
    const state: GenerationState = {
      sectionId,
      status: 'generating',
      nextChunkIndex: previousCursor,
      errorMessage: null,
      errorCode: null,
      updatedAt,
    };
    this.states.set(sectionId, state);
    this.stateHistory.push(state);
    this.events.push('state:generating');
    return {section: {...current}, previousCursor};
  }

  async setGenerationState(state: GenerationState) {
    this.states.set(state.sectionId, {...state});
    this.stateHistory.push({...state});
    const current = this.nodes.find(item => item.id === state.sectionId);
    if (current) {
      current.status = state.status;
    }
    this.events.push(`state:${state.status}`);
  }

  async saveCardsAndAdvance(sectionId: string, cards: ConceptCard[], nextChunkIndex: number, updatedAt?: string) {
    this.cards.push(...cards);
    this.saveCalls.push({sectionId, cards, nextChunkIndex, updatedAt});
    const current = this.nodes.find(item => item.id === sectionId)!;
    current.status = 'completed';
    current.chunkIndex = nextChunkIndex;
    this.states.set(sectionId, {
      sectionId,
      status: 'completed',
      nextChunkIndex,
      errorMessage: null,
      errorCode: null,
      updatedAt: updatedAt ?? timestamp,
    });
    this.events.push('save');
  }

  async getCard(cardId: string) {
    return this.cards.find(card => card.id === cardId) ?? null;
  }

  async insertMessage(message: ChatMessage) {
    this.messages.push(message);
    this.events.push(`message:${message.role}`);
  }
}

function createHarness(nodes = [node('section-a', 10)]) {
  const repositories = new MemoryRepositories(nodes);
  const client = {complete: jest.fn<Promise<string>, [Array<{role: string; content: string}>]>()};
  let nextId = 0;
  const generator = loadGenerator().createDeepSeekGenerator({
    repositories: repositories as unknown as Parameters<GeneratorModule['createDeepSeekGenerator']>[0]['repositories'],
    client,
    createId: () => `generated-${++nextId}`,
    createClaimToken: () => 'claim:test',
    now: () => timestamp,
  });
  return {repositories, client, generator};
}

describe('DeepSeek generation orchestration', () => {
  it('persists overview-first complete cards and advances atomically', async () => {
    expect(() => loadGenerator()).not.toThrow();

    const {repositories, client, generator} = createHarness();
    client.complete.mockResolvedValue(JSON.stringify([
      {...generatedCard('section_overview', 'Overview'), chapter: 'MODEL_CHAPTER', sourceText: 'MODEL_SOURCE'},
      {...generatedCard('concept', 'Concept'), chapter: 'MODEL_CHAPTER', sourceText: 'MODEL_SOURCE'},
    ]));

    const result = await generator.generateSection('section-a');

    expect(result.sectionId).toBe('section-a');
    expect(result.cards).toEqual([
      expect.objectContaining({
        id: 'generated-1',
        cardType: 'section_overview',
        bookId: 'book-1',
        sectionId: 'section-a',
        chapter: 'Chapter section-a',
        sourceText: 'FULL_BODY_section-a',
        createdAt: timestamp,
      }),
      expect.objectContaining({
        id: 'generated-2',
        cardType: 'concept',
        chapter: 'Chapter section-a',
        sourceText: 'FULL_BODY_section-a',
        questions: ['Why?', 'How?', 'What follows?'],
      }),
    ]);
    expect(repositories.events).toEqual(['state:generating', 'save']);
    expect(repositories.saveCalls[0]).toMatchObject({sectionId: 'section-a', nextChunkIndex: 1, updatedAt: timestamp});
    const requestText = client.complete.mock.calls[0][0].map(message => message.content).join('\n');
    expect(requestText.match(/FULL_BODY_section-a/g)).toHaveLength(1);
  });

  it('uses the trusted root chapter and selected child section in nested outlines', async () => {
    const root = {
      ...node('root', 0),
      title: 'Trusted Root Chapter',
      childIds: ['parent'],
    };
    const parent = {
      ...node('parent', 10),
      parentId: 'root',
      title: 'Intermediate Section',
      level: 2,
      childIds: ['leaf'],
    };
    const leaf = {
      ...node('leaf', 20),
      parentId: 'parent',
      title: 'Selected Leaf Section',
      level: 3,
    };
    const {client, generator} = createHarness([root, parent, leaf]);
    client.complete.mockResolvedValue(JSON.stringify([
      {...generatedCard('section_overview', 'Overview'), chapter: 'MODEL_CHAPTER', sourceText: 'MODEL_SOURCE'},
    ]));

    const result = await generator.generateSection('leaf');

    expect(result.cards[0]).toMatchObject({
      chapter: 'Trusted Root Chapter',
      sectionId: 'leaf',
      sourceText: 'FULL_BODY_leaf',
    });
    const requestText = client.complete.mock.calls[0][0].map(message => message.content).join('\n');
    expect(requestText).toContain('"chapter":"Trusted Root Chapter"');
    expect(requestText).toContain('"sectionTitle":"Selected Leaf Section"');
    expect(requestText).not.toContain('MODEL_CHAPTER');
  });

  it('makes exactly one constrained repair call after invalid JSON', async () => {
    const {repositories, client, generator} = createHarness();
    client.complete
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(JSON.stringify([generatedCard('section_overview', 'Repaired')]));

    await generator.generateSection('section-a');

    expect(client.complete).toHaveBeenCalledTimes(2);
    const repairMessages = client.complete.mock.calls[1][0];
    expect(repairMessages).toEqual(expect.arrayContaining([
      {role: 'assistant', content: 'not-json'},
      expect.objectContaining({role: 'user', content: expect.stringContaining('Repair') as string}),
    ]));
    expect(repositories.cards).toHaveLength(1);
  });

  it('persists no cards or cursor changes when the one repair is still invalid', async () => {
    const {repositories, client, generator} = createHarness([node('section-a', 10, 'failed')]);
    repositories.states.set('section-a', {
      sectionId: 'section-a',
      status: 'failed',
      nextChunkIndex: 7,
      errorMessage: 'Previous failure',
      errorCode: 'previous',
      updatedAt: timestamp,
    });
    client.complete.mockResolvedValue('still invalid');

    await expect(generator.generateSection('section-a')).rejects.toMatchObject({
      name: 'DeepSeekSchemaError',
      retryable: true,
    });

    expect(client.complete).toHaveBeenCalledTimes(2);
    expect(repositories.cards).toEqual([]);
    expect(repositories.saveCalls).toEqual([]);
    expect(repositories.stateHistory).toEqual([
      expect.objectContaining({status: 'generating', nextChunkIndex: 7}),
      expect.objectContaining({status: 'failed', nextChunkIndex: 7, errorCode: 'deepseek_schema_invalid'}),
    ]);
  });

  it('prioritizes the earliest failed section before queued work', async () => {
    const nodes = [node('later', 200), node('failed-earlier', 5, 'failed'), node('earliest', 20)];
    const {repositories, client, generator} = createHarness(nodes);
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Overview')]));

    await expect(generator.generateNextSection('book-1')).resolves.toMatchObject({sectionId: 'failed-earlier'});
    expect(repositories.saveCalls[0].sectionId).toBe('failed-earlier');
  });

  it('selects the next queued section after the active reading section', async () => {
    const nodes = [node('behind', 5), node('active', 20, 'completed'), node('next', 40), node('later', 80)];
    const {repositories, client, generator} = createHarness(nodes);
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Overview')]));

    await expect(generator.generateNextSection('book-1', 'active')).resolves.toMatchObject({sectionId: 'next'});
    expect(repositories.saveCalls[0].sectionId).toBe('next');
  });

  it('cleanly no-ops while any section in the book is already generating', async () => {
    const {client, generator} = createHarness([node('active', 10, 'completed'), node('busy', 20, 'generating'), node('next', 30)]);
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Overview')]));

    await expect(generator.generateNextSection('book-1', 'active')).resolves.toBeNull();
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('returns null when no queued or failed sections remain', async () => {
    const nodes = [node('done', 10, 'completed')];
    const {generator} = createHarness(nodes);

    await expect(generator.generateNextSection('book-1')).resolves.toBeNull();
  });

  it('retries a failed section while preserving and then advancing its prior cursor', async () => {
    const {repositories, client, generator} = createHarness([node('section-a', 10, 'failed')]);
    repositories.states.set('section-a', {
      sectionId: 'section-a',
      status: 'failed',
      nextChunkIndex: 3,
      errorMessage: 'Retry me',
      errorCode: 'deepseek_network_error',
      updatedAt: timestamp,
    });
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Overview')]));

    await generator.generateSection('section-a');

    expect(repositories.stateHistory[0]).toMatchObject({status: 'generating', nextChunkIndex: 3});
    expect(repositories.saveCalls[0].nextChunkIndex).toBe(4);
  });

  it.each(['generating', 'completed'] as const)('rejects an already %s section before requesting or saving', async status => {
    const {repositories, client, generator} = createHarness([node('section-a', 10, status)]);
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Duplicate')]));

    await expect(generator.generateSection('section-a')).rejects.toMatchObject({
      code: 'deepseek_section_not_claimable',
      retryable: false,
    });

    expect(client.complete).not.toHaveBeenCalled();
    expect(repositories.saveCalls).toEqual([]);
  });

  it('allows only one concurrent generation claim and one card save', async () => {
    const {repositories, client, generator} = createHarness();
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Overview')]));

    const results = await Promise.allSettled([
      generator.generateSection('section-a'),
      generator.generateSection('section-a'),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(repositories.saveCalls).toHaveLength(1);
    expect(repositories.cards).toHaveLength(1);
  });
});

describe('card chat orchestration', () => {
  it('persists the user before request and the validated assistant answer afterward', async () => {
    const {repositories, client, generator} = createHarness();
    repositories.cards.push({
      id: 'card-1',
      bookId: 'book-1',
      sectionId: 'section-a',
      isFavorite: false,
      createdAt: timestamp,
      ...generatedCard('concept', 'Concept'),
    });
    client.complete.mockImplementation(async messages => {
      expect(repositories.events.at(-1)).toBe('message:user');
      const prompt = messages.map(message => message.content).join('\n');
      expect(prompt).toContain('Bounded source excerpt');
      expect(prompt).toContain('$...$');
      expect(prompt).not.toContain('FULL_BODY_section-a');
      return 'Readable answer with $x=y$, where $x$ is input and $y$ is output.';
    });

    const answer = await generator.askCard('card-1', 'Why?');

    expect(answer).toMatchObject({id: 'generated-2', role: 'assistant', cardId: 'card-1'});
    expect(repositories.messages).toEqual([
      expect.objectContaining({id: 'generated-1', role: 'user', content: 'Why?'}),
      expect.objectContaining({id: 'generated-2', role: 'assistant', content: expect.stringContaining('$x=y$')}),
    ]);
  });

  it('keeps the persisted user question but rejects an invalid formula answer', async () => {
    const {repositories, client, generator} = createHarness();
    repositories.cards.push({
      id: 'card-1',
      bookId: 'book-1',
      sectionId: 'section-a',
      isFavorite: false,
      createdAt: timestamp,
      ...generatedCard('concept', 'Concept'),
    });
    client.complete.mockResolvedValue('Invalid formula x≤y without delimiters.');

    await expect(generator.askCard('card-1', 'Why?')).rejects.toMatchObject({code: 'deepseek_chat_invalid'});
    expect(repositories.messages).toHaveLength(1);
    expect(repositories.messages[0].role).toBe('user');
  });

  it.each([
    'Invalid bare equality x = y in an answer.',
    'Invalid bare TeX \\frac{x}{y} in an answer.',
    'Invalid bare exponent x^2 in an answer.',
    'Invalid bare sum a+b in an answer.',
    'Invalid bare division a/b in an answer.',
    'Invalid implicit multiplication 2x in an answer.',
    'Invalid superscript exponent x² in an answer.',
    'Invalid Unicode math minus x−y in an answer.',
  ])('rejects likely formulas without LaTeX delimiters: %s', async invalidAnswer => {
    const {repositories, client, generator} = createHarness();
    repositories.cards.push({
      id: 'card-1',
      bookId: 'book-1',
      sectionId: 'section-a',
      isFavorite: false,
      createdAt: timestamp,
      ...generatedCard('concept', 'Concept'),
    });
    client.complete.mockResolvedValue(invalidAnswer);

    await expect(generator.askCard('card-1', 'Why?')).rejects.toMatchObject({code: 'deepseek_chat_invalid'});
    expect(repositories.messages).toHaveLength(1);
  });

  it('accepts ordinary chat prose without formula false positives', async () => {
    const {repositories, client, generator} = createHarness();
    repositories.cards.push({
      id: 'card-1',
      bookId: 'book-1',
      sectionId: 'section-a',
      isFavorite: false,
      createdAt: timestamp,
      ...generatedCard('concept', 'Concept'),
    });
    client.complete.mockResolvedValue('Use C++ and A/B testing and/or version 2.0 in an R&D well-being study.');

    await expect(generator.askCard('card-1', 'Why?')).resolves.toMatchObject({role: 'assistant'});
  });
});
