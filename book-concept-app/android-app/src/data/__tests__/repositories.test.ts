import type {ConceptCard, OutlineNode, TtsCacheEntry} from '../../domain/models';
import {
  createRepositories,
  migrateDatabase,
  openDatabase,
  type Database,
  type QueryResult,
} from '../database';

type Row = Record<string, unknown>;

const mockNativeOpenDatabase = jest.fn();

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: (...args: unknown[]) => mockNativeOpenDatabase(...args),
}));

class MemoryDatabase implements Database {
  public readonly statements: string[] = [];
  public transactionCount = 0;
  public userVersion = 0;
  public foreignKeysEnabled = false;
  public failCursorAdvance = false;
  public failOutlineInsert = false;
  public failMigrationStatement: string | null = null;
  public readonly transactionBatches: string[][] = [];

  private activeTransactionStatements: string[] | null = null;

  private state = {
    books: new Map<string, Row>(),
    outlineNodes: new Map<string, Row>(),
    cards: new Map<string, Row>(),
    messages: new Map<string, Row>(),
    generationStates: new Map<string, Row>(),
    ttsCache: new Map<string, Row>(),
  };

  seedLegacyCard(row: Row): void {
    this.state.cards.set(row.id as string, {...row});
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.statements.push(sql);
    this.activeTransactionStatements?.push(sql);
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    const insert = /INSERT\s+INTO\s+\w+\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i.exec(sql);
    if (insert) {
      const columnCount = insert[1].split(',').length;
      const valueCount = insert[2].split(',').length;
      const placeholderCount = (insert[2].match(/\?/g) ?? []).length;
      if (columnCount !== valueCount || params.length !== placeholderCount) {
        throw new Error('INSERT column and parameter count mismatch');
      }
    }

    if (this.failMigrationStatement && normalized === this.failMigrationStatement) {
      throw new Error(`Migration failed: ${normalized}`);
    }

    if (normalized === 'PRAGMA FOREIGN_KEYS = ON') {
      this.foreignKeysEnabled = true;
      return {rows: [], rowsAffected: 0};
    }
    if (normalized === 'PRAGMA USER_VERSION') {
      return {rows: [{user_version: this.userVersion}], rowsAffected: 0};
    }
    if (/^PRAGMA USER_VERSION = [123]$/.test(normalized)) {
      this.userVersion = Number(normalized.at(-1));
      return {rows: [], rowsAffected: 0};
    }
    if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX') || normalized.startsWith('ALTER TABLE')) {
      return {rows: [], rowsAffected: 0};
    }
    if (normalized.startsWith('INSERT INTO BOOKS')) {
      const [id, title, author, sourceUri, originalText, tags, createdAt, updatedAt] = params;
      this.state.books.set(id as string, {
        id,
        title,
        author,
        source_uri: sourceUri,
        original_text: originalText,
        tags,
        created_at: createdAt,
        updated_at: updatedAt,
        last_read_card_id: null,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('SELECT * FROM BOOKS WHERE ID')) {
      const book = this.state.books.get(params[0] as string);
      return {rows: book ? [book] : [], rowsAffected: 0};
    }
    if (normalized.startsWith('SELECT * FROM BOOKS ORDER BY')) {
      return {rows: [...this.state.books.values()], rowsAffected: 0};
    }
    if (normalized.startsWith('UPDATE BOOKS SET LAST_READ_CARD_ID')) {
      const book = this.state.books.get(params[1] as string);
      if (book) {
        book.last_read_card_id = params[0];
      }
      return {rows: [], rowsAffected: book ? 1 : 0};
    }
    if (normalized.startsWith('SELECT LAST_READ_CARD_ID FROM BOOKS')) {
      const book = this.state.books.get(params[0] as string);
      return {rows: book ? [{last_read_card_id: book.last_read_card_id}] : [], rowsAffected: 0};
    }
    if (normalized.startsWith('INSERT INTO OUTLINE_NODES')) {
      if (this.failOutlineInsert) {
        throw new Error('outline insert failed');
      }
      const [id, bookId, parentId, title, level, body, childIds, status, chunkIndex, startOffset, endOffset] = params;
      if (!this.state.books.has(bookId as string)) {
        throw new Error('FOREIGN KEY constraint failed: outline_nodes.book_id');
      }
      if (parentId !== null && !this.state.outlineNodes.has(parentId as string)) {
        throw new Error('FOREIGN KEY constraint failed: outline_nodes.parent_id');
      }
      this.state.outlineNodes.set(id as string, {
        id,
        book_id: bookId,
        parent_id: parentId,
        title,
        level,
        body,
        child_ids: childIds,
        status,
        chunk_index: chunkIndex,
        start_offset: startOffset,
        end_offset: endOffset,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('SELECT * FROM OUTLINE_NODES WHERE BOOK_ID')) {
      return {
        rows: [...this.state.outlineNodes.values()].filter(node => node.book_id === params[0]),
        rowsAffected: 0,
      };
    }
    if (normalized.startsWith('SELECT * FROM OUTLINE_NODES WHERE ID')) {
      const outlineNode = this.state.outlineNodes.get(params[0] as string);
      return {rows: outlineNode ? [outlineNode] : [], rowsAffected: 0};
    }
    if (normalized.startsWith('INSERT INTO CARDS')) {
      const [
        id, bookId, sectionId, title, summary, body, keyPoints, sourceExcerpt, formulae,
        cardType, chapter, sourceText, oneSentence, simpleExplanation, fable, formula,
        formulaExplanation, prerequisites, relatedConcepts, questions, isFavorite, createdAt,
      ] = params;
      const section = this.state.outlineNodes.get(sectionId as string);
      if (!this.state.books.has(bookId as string) || section?.book_id !== bookId) {
        throw new Error('FOREIGN KEY constraint failed: cards parents');
      }
      this.state.cards.set(id as string, {
        id,
        book_id: bookId,
        section_id: sectionId,
        title,
        summary,
        body,
        key_points: keyPoints,
        source_excerpt: sourceExcerpt,
        formulae,
        card_type: cardType,
        chapter,
        source_text: sourceText,
        one_sentence: oneSentence,
        simple_explanation: simpleExplanation,
        fable,
        formula,
        formula_explanation: formulaExplanation,
        prerequisites,
        related_concepts: relatedConcepts,
        questions,
        is_favorite: isFavorite,
        created_at: createdAt,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('SELECT * FROM CARDS WHERE BOOK_ID')) {
      return {
        rows: [...this.state.cards.values()].filter(card => card.book_id === params[0]),
        rowsAffected: 0,
      };
    }
    if (normalized.startsWith('SELECT * FROM CARDS WHERE ID')) {
      const existingCard = this.state.cards.get(params[0] as string);
      return {rows: existingCard ? [existingCard] : [], rowsAffected: 0};
    }
    if (normalized.startsWith('SELECT IS_FAVORITE FROM CARDS')) {
      const card = this.state.cards.get(params[0] as string);
      return {rows: card ? [{is_favorite: card.is_favorite}] : [], rowsAffected: 0};
    }
    if (normalized.startsWith('UPDATE CARDS SET IS_FAVORITE')) {
      const card = this.state.cards.get(params[1] as string);
      if (card) {
        card.is_favorite = params[0];
      }
      return {rows: [], rowsAffected: card ? 1 : 0};
    }
    if (normalized.startsWith('UPDATE CARDS SET SOURCE_TEXT')) {
      for (const existingCard of this.state.cards.values()) {
        existingCard.source_text = existingCard.source_excerpt;
        existingCard.one_sentence = existingCard.summary;
        existingCard.simple_explanation = existingCard.body;
        existingCard.fable = existingCard.body;
        existingCard.prerequisites = existingCard.key_points;
      }
      return {rows: [], rowsAffected: this.state.cards.size};
    }
    if (normalized.startsWith('INSERT INTO CHAT_MESSAGES')) {
      const [id, cardId, role, content, citations, createdAt] = params;
      if (!this.state.cards.has(cardId as string)) {
        throw new Error('FOREIGN KEY constraint failed: chat_messages.card_id');
      }
      this.state.messages.set(id as string, {id, card_id: cardId, role, content, citations, created_at: createdAt});
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('SELECT * FROM CHAT_MESSAGES')) {
      return {
        rows: [...this.state.messages.values()].filter(message => message.card_id === params[0]),
        rowsAffected: 0,
      };
    }
    if (normalized.startsWith('INSERT INTO GENERATION_STATE')) {
      if (this.failCursorAdvance) {
        throw new Error('cursor advance failed');
      }
      const [sectionId, status, nextChunkIndex] = params;
      const errorMessage = params.length === 6 ? params[3] : null;
      const errorCode = params.length === 6 ? params[4] : null;
      const updatedAt = params.length === 6 ? params[5] : params[3];
      if (!this.state.outlineNodes.has(sectionId as string)) {
        throw new Error('FOREIGN KEY constraint failed: generation_state.section_id');
      }
      this.state.generationStates.set(sectionId as string, {
        section_id: sectionId,
        status,
        next_chunk_index: nextChunkIndex,
        error_message: errorMessage,
        error_code: errorCode,
        updated_at: updatedAt,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('UPDATE GENERATION_STATE SET')) {
      if (this.failCursorAdvance) {
        throw new Error('cursor advance failed');
      }
      const [status, nextChunkIndex, updatedAt, sectionId] = params;
      const state = this.state.generationStates.get(sectionId as string);
      if (state) {
        state.status = status;
        state.next_chunk_index = nextChunkIndex;
        state.updated_at = updatedAt;
      }
      return {rows: [], rowsAffected: state ? 1 : 0};
    }
    if (normalized.startsWith('UPDATE OUTLINE_NODES SET')) {
      const [status] = params;
      const chunkIndex = params.length === 3 ? params[1] : undefined;
      const sectionId = params.length === 3 ? params[2] : params[1];
      const node = this.state.outlineNodes.get(sectionId as string);
      if (node) {
        node.status = status;
        if (chunkIndex !== undefined) {
          node.chunk_index = chunkIndex;
        }
      }
      return {rows: [], rowsAffected: node ? 1 : 0};
    }
    if (normalized.startsWith('SELECT * FROM GENERATION_STATE')) {
      const state = this.state.generationStates.get(params[0] as string);
      return {rows: state ? [state] : [], rowsAffected: 0};
    }
    if (normalized.startsWith('INSERT INTO TTS_CACHE')) {
      const [cacheKey, filePath, voice, speed, modelVersion, settings, createdAt, lastAccessedAt] = params;
      this.state.ttsCache.set(cacheKey as string, {
        cache_key: cacheKey,
        file_path: filePath,
        voice,
        speed,
        model_version: modelVersion,
        settings,
        created_at: createdAt,
        last_accessed_at: lastAccessedAt,
      });
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('SELECT * FROM TTS_CACHE')) {
      const entry = this.state.ttsCache.get(params[0] as string);
      return {rows: entry ? [entry] : [], rowsAffected: 0};
    }

    throw new Error(`Unsupported SQL: ${sql}`);
  }

  async transaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const previousTransactionStatements = this.activeTransactionStatements;
    const transactionStatements: string[] = [];
    this.activeTransactionStatements = transactionStatements;
    const copyRows = (rows: Map<string, Row>) =>
      new Map(Array.from(rows, ([key, row]) => [key, {...row}]));
    const snapshot = {
      books: copyRows(this.state.books),
      outlineNodes: copyRows(this.state.outlineNodes),
      cards: copyRows(this.state.cards),
      messages: copyRows(this.state.messages),
      generationStates: copyRows(this.state.generationStates),
      ttsCache: copyRows(this.state.ttsCache),
      userVersion: this.userVersion,
      foreignKeysEnabled: this.foreignKeysEnabled,
    };
    try {
      const result = await work(this);
      this.transactionBatches.push(transactionStatements);
      return result;
    } catch (error) {
      this.state = snapshot;
      this.userVersion = snapshot.userVersion;
      this.foreignKeysEnabled = snapshot.foreignKeysEnabled;
      throw error;
    } finally {
      this.activeTransactionStatements = previousTransactionStatements;
    }
  }
}

const book = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Ada',
  sourceUri: 'file:///book.md',
  originalText: '# Test',
  tags: ['math', 'notes'],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

const card: ConceptCard = {
  id: 'card-1',
  bookId: book.id,
  sectionId: 'section-1',
  cardType: 'concept',
  chapter: 'Chapter 1',
  title: 'Card',
  sourceText: 'Excerpt',
  oneSentence: 'A short summary',
  simpleExplanation: 'The explanation',
  fable: 'A detailed fable',
  formula: '$x=y$',
  formulaExplanation: '$x$ and $y$ are values.',
  prerequisites: ['one', 'two'],
  relatedConcepts: ['three'],
  questions: ['Why?', 'How?', 'What next?'],
  isFavorite: false,
  createdAt: '2026-07-12T00:00:00.000Z',
};

const outlineNode: OutlineNode = {
  id: 'outline-1',
  bookId: book.id,
  parentId: null,
  title: 'Outline',
  level: 1,
  body: 'Body',
  childIds: [],
  status: 'queued',
  chunkIndex: 0,
  startOffset: 7,
  endOffset: 11,
};

async function createReadyRepositories(database = new MemoryDatabase()) {
  await migrateDatabase(database);
  const repositories = createRepositories(database);
  await repositories.insertBook(book);
  await database.execute(
    `INSERT INTO outline_nodes (
      id, book_id, parent_id, title, level, body, child_ids, status, chunk_index, start_offset, end_offset
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [card.sectionId, book.id, null, 'Section', 1, 'Body', '[]', 'queued', 0, 0, 4],
  );
  return {database, repositories};
}

describe('SQLite repositories', () => {
  it('applies version 3 schema with foreign keys enabled', async () => {
    const database = new MemoryDatabase();

    await migrateDatabase(database);

    expect(database.foreignKeysEnabled).toBe(true);
    expect(database.userVersion).toBe(3);
    const statements = database.statements.join('\n');
    for (const table of [
      'books',
      'outline_nodes',
      'cards',
      'chat_messages',
      'generation_state',
      'tts_cache',
    ]) {
      expect(statements).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(database.transactionBatches).toHaveLength(1);
    expect(database.transactionBatches[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS books'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS outline_nodes'),
      'PRAGMA user_version = 3',
    ]));
    expect(database.transactionBatches[0].at(-1)).toBe('PRAGMA user_version = 3');
  });

  it('upgrades an existing version 1 database without resetting it', async () => {
    const database = new MemoryDatabase();
    database.userVersion = 1;

    await migrateDatabase(database);

    expect(database.userVersion).toBe(3);
    expect(database.statements.join('\n')).toContain('ALTER TABLE outline_nodes ADD COLUMN start_offset');
    expect(database.statements.join('\n')).toContain('ALTER TABLE outline_nodes ADD COLUMN end_offset');
    expect(database.transactionBatches[0]).toEqual(expect.arrayContaining([
      'ALTER TABLE outline_nodes ADD COLUMN start_offset INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE outline_nodes ADD COLUMN end_offset INTEGER NOT NULL DEFAULT 0',
      expect.stringContaining('ALTER TABLE cards ADD COLUMN card_type'),
      'PRAGMA user_version = 3',
    ]));
  });

  it('rolls back a failed version 2 migration without advancing the schema version', async () => {
    const database = new MemoryDatabase();
    database.userVersion = 1;
    database.failMigrationStatement = 'ALTER TABLE OUTLINE_NODES ADD COLUMN END_OFFSET INTEGER NOT NULL DEFAULT 0';

    await expect(migrateDatabase(database)).rejects.toThrow('Migration failed');

    expect(database.userVersion).toBe(1);
    expect(database.transactionCount).toBe(1);
    expect(database.transactionBatches).toEqual([]);
  });

  it('atomically migrates v2 cards to v3 and preserves legacy fields through fallbacks', async () => {
    const database = new MemoryDatabase();
    database.userVersion = 2;
    database.seedLegacyCard({
      id: 'legacy-card',
      book_id: book.id,
      section_id: card.sectionId,
      title: 'Legacy title',
      summary: 'Legacy sentence',
      body: 'Legacy explanation',
      key_points: JSON.stringify(['legacy prerequisite']),
      source_excerpt: 'Legacy source',
      formulae: JSON.stringify(['$x=y$']),
      is_favorite: 1,
      created_at: card.createdAt,
    });

    await migrateDatabase(database);

    expect(database.userVersion).toBe(3);
    expect(database.transactionBatches).toHaveLength(1);
    expect(database.transactionBatches[0].at(-1)).toBe('PRAGMA user_version = 3');
    expect(database.transactionBatches[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('ALTER TABLE cards ADD COLUMN card_type'),
      expect.stringContaining('ALTER TABLE cards ADD COLUMN questions'),
      expect.stringContaining('UPDATE cards SET'),
    ]));

    const [preserved] = await createRepositories(database).listCards(book.id);
    expect(preserved).toEqual({
      id: 'legacy-card',
      cardType: 'concept',
      chapter: '',
      title: 'Legacy title',
      sourceText: 'Legacy source',
      oneSentence: 'Legacy sentence',
      simpleExplanation: 'Legacy explanation',
      fable: 'Legacy explanation',
      formula: '$x=y$',
      formulaExplanation: '',
      prerequisites: ['legacy prerequisite'],
      relatedConcepts: [],
      questions: [],
      isFavorite: true,
      bookId: book.id,
      sectionId: card.sectionId,
      createdAt: card.createdAt,
    });
  });

  it('rolls back the complete v3 migration when any statement fails', async () => {
    const database = new MemoryDatabase();
    database.userVersion = 2;
    database.failMigrationStatement = "ALTER TABLE CARDS ADD COLUMN QUESTIONS TEXT NOT NULL DEFAULT '[]'";

    await expect(migrateDatabase(database)).rejects.toThrow('Migration failed');

    expect(database.userVersion).toBe(2);
    expect(database.transactionBatches).toEqual([]);
  });

  it('retries database initialization after a failed open', async () => {
    const rows = [{user_version: 0}];
    const nativeDatabase = {
      executeSql: jest.fn(async (sql: string) => [
        {
          rows: {
            length: sql === 'PRAGMA user_version' ? rows.length : 0,
            item: (index: number) => rows[index],
          },
          rowsAffected: 0,
        },
      ]),
      sqlBatch: jest.fn(async () => undefined),
    };
    mockNativeOpenDatabase
      .mockRejectedValueOnce(new Error('first open failed'))
      .mockResolvedValueOnce(nativeDatabase);

    await expect(openDatabase()).rejects.toThrow('first open failed');
    await expect(openDatabase()).resolves.toBeDefined();

    expect(mockNativeOpenDatabase).toHaveBeenCalledTimes(2);
  });

  it('round trips JSON array fields for books and cards', async () => {
    const {repositories} = await createReadyRepositories();

    await repositories.insertCard(card);

    await expect(repositories.getBook(book.id)).resolves.toMatchObject({tags: ['math', 'notes']});
    await expect(repositories.listCards(book.id)).resolves.toEqual([card]);
  });

  it('rejects outline inserts whose column and parameter counts differ', async () => {
    const database = new MemoryDatabase();
    await migrateDatabase(database);
    const repositories = createRepositories(database);
    await repositories.insertBook(book);

    await expect(database.execute(
      `INSERT INTO outline_nodes (
        id, book_id, parent_id, title, level, body, child_ids, status, chunk_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['bad', book.id, null, 'Bad', 1, 'Body', '[]', 'queued', 0, 0, 4],
    )).rejects.toThrow('parameter count');
  });

  it('inserts a book and its outline atomically', async () => {
    const database = new MemoryDatabase();
    await migrateDatabase(database);
    const transactionCountAfterMigration = database.transactionCount;
    const repositories = createRepositories(database);
    database.failOutlineInsert = true;

    await expect(repositories.insertBookWithOutline(book, [outlineNode])).rejects.toThrow('outline insert failed');

    await expect(repositories.getBook(book.id)).resolves.toBeNull();
    expect(database.transactionCount).toBe(transactionCountAfterMigration + 1);
  });

  it('round trips imported outline source offsets atomically', async () => {
    const database = new MemoryDatabase();
    await migrateDatabase(database);
    const transactionCountAfterMigration = database.transactionCount;
    const repositories = createRepositories(database);

    await repositories.insertBookWithOutline(book, [outlineNode]);

    await expect(repositories.listOutlineNodes(book.id)).resolves.toEqual([outlineNode]);
    expect(database.transactionCount).toBe(transactionCountAfterMigration + 1);
  });

  it('toggles a card favorite and returns its new value', async () => {
    const {repositories} = await createReadyRepositories();
    await repositories.insertCard(card);

    await expect(repositories.toggleFavorite(card.id)).resolves.toBe(true);
    await expect(repositories.listCards(book.id)).resolves.toMatchObject([{isFavorite: true}]);
  });

  it('looks up generation records and synchronizes section status without changing its cursor', async () => {
    const {repositories} = await createReadyRepositories();
    const generationRepositories = repositories as unknown as typeof repositories & {
      getOutlineNode(sectionId: string): Promise<OutlineNode | null>;
      getCard(cardId: string): Promise<ConceptCard | null>;
    };
    await repositories.insertCard(card);

    await repositories.setGenerationState({
      sectionId: card.sectionId,
      status: 'failed',
      nextChunkIndex: 4,
      errorMessage: 'Safe retry message',
      errorCode: 'deepseek_network_error',
      updatedAt: card.createdAt,
    });

    await expect(generationRepositories.getOutlineNode(card.sectionId)).resolves.toMatchObject({
      id: card.sectionId,
      status: 'failed',
      chunkIndex: 0,
    });
    await expect(generationRepositories.getCard(card.id)).resolves.toEqual(card);
    await expect(repositories.getGenerationState(card.sectionId)).resolves.toMatchObject({
      status: 'failed',
      nextChunkIndex: 4,
      errorCode: 'deepseek_network_error',
    });
  });

  it('persists and retrieves the last-read card for a book', async () => {
    const {repositories} = await createReadyRepositories();

    await repositories.setLastReadCard(book.id, card.id);

    await expect(repositories.getLastReadCard(book.id)).resolves.toBe(card.id);
  });

  it('rolls back inserted cards when generation cursor advancement fails', async () => {
    const database = new MemoryDatabase();
    const {repositories} = await createReadyRepositories(database);
    await repositories.setGenerationState({
      sectionId: card.sectionId,
      status: 'generating',
      nextChunkIndex: 0,
      errorMessage: null,
      errorCode: null,
      updatedAt: card.createdAt,
    });
    database.failCursorAdvance = true;

    await expect(repositories.saveCardsAndAdvance(card.sectionId, [card], 1)).rejects.toThrow('cursor advance failed');

    await expect(repositories.listCards(book.id)).resolves.toEqual([]);
  });

  it('saves cards and advances an absent generation cursor atomically', async () => {
    const {database, repositories} = await createReadyRepositories();
    const transactionCountAfterMigration = database.transactionCount;

    await repositories.saveCardsAndAdvance(card.sectionId, [card], 2);

    await expect(repositories.listCards(book.id)).resolves.toEqual([card]);
    await expect(repositories.getGenerationState(card.sectionId)).resolves.toMatchObject({
      status: 'completed',
      nextChunkIndex: 2,
    });
    expect(database.transactionCount).toBe(transactionCountAfterMigration + 1);
  });

  it('rejects a negative generation cursor before opening a transaction', async () => {
    const {database, repositories} = await createReadyRepositories();
    const transactionCountAfterMigration = database.transactionCount;

    await expect(repositories.saveCardsAndAdvance(card.sectionId, [card], -1)).rejects.toThrow('Invalid generation cursor');

    expect(database.transactionCount).toBe(transactionCountAfterMigration);
  });

  it('round trips TTS cache metadata', async () => {
    const {repositories} = await createReadyRepositories();
    const entry: TtsCacheEntry = {
      cacheKey: 'key-1',
      filePath: '/cache/key-1.wav',
      voice: 'zh-female',
      speed: 1.2,
      modelVersion: 'v1',
      settings: {pitch: 0, normalize: true},
      createdAt: card.createdAt,
      lastAccessedAt: card.createdAt,
    };

    await repositories.upsertTtsCache(entry);

    await expect(repositories.getTtsCache(entry.cacheKey)).resolves.toEqual(entry);
  });
});
