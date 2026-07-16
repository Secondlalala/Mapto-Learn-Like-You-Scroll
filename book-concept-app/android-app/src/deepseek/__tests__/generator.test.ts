import type {
  ChatMessage,
  ConceptCard,
  GenerationState,
  OutlineNode,
} from '../../domain/models';
import type {Repositories} from '../../data/repositories';

type GeneratorModule = {
  createDeepSeekGenerator: (dependencies: {
    repositories: Pick<Repositories,
      'getOutlineNode' | 'listOutlineNodes' | 'getGenerationState' | 'setGenerationState' |
      'saveCardsAndAdvance' | 'getCard' | 'insertMessage'>;
    client: {complete: (messages: Array<{role: string; content: string}>) => Promise<string>};
    createId: () => string;
    now: () => string;
  }) => {
    generateSection: (sectionId: string) => Promise<{sectionId: string; cards: ConceptCard[]}>;
    generateNextSection: (bookId: string) => Promise<{sectionId: string; cards: ConceptCard[]} | null>;
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
    now: () => timestamp,
  });
  return {repositories, client, generator};
}

describe('DeepSeek generation orchestration', () => {
  it('persists overview-first complete cards and advances atomically', async () => {
    expect(() => loadGenerator()).not.toThrow();

    const {repositories, client, generator} = createHarness();
    client.complete.mockResolvedValue(JSON.stringify([
      generatedCard('section_overview', 'Overview'),
      generatedCard('concept', 'Concept'),
    ]));

    const result = await generator.generateSection('section-a');

    expect(result.sectionId).toBe('section-a');
    expect(result.cards).toEqual([
      expect.objectContaining({id: 'generated-1', cardType: 'section_overview', bookId: 'book-1', sectionId: 'section-a', createdAt: timestamp}),
      expect.objectContaining({id: 'generated-2', cardType: 'concept', questions: ['Why?', 'How?', 'What follows?']}),
    ]);
    expect(repositories.events).toEqual(['state:generating', 'save']);
    expect(repositories.saveCalls[0]).toMatchObject({sectionId: 'section-a', nextChunkIndex: 1, updatedAt: timestamp});
    const requestText = client.complete.mock.calls[0][0].map(message => message.content).join('\n');
    expect(requestText.match(/FULL_BODY_section-a/g)).toHaveLength(1);
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

  it('selects the earliest queued section by source offset and returns null when none remain', async () => {
    const nodes = [node('later', 200), node('failed-earlier', 5, 'failed'), node('earliest', 20)];
    const {repositories, client, generator} = createHarness(nodes);
    client.complete.mockResolvedValue(JSON.stringify([generatedCard('section_overview', 'Overview')]));

    await expect(generator.generateNextSection('book-1')).resolves.toMatchObject({sectionId: 'earliest'});
    expect(repositories.saveCalls[0].sectionId).toBe('earliest');

    nodes.find(item => item.id === 'later')!.status = 'completed';
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
});
