import type {ConceptCard, TtsCacheEntry} from '../../domain/models';
import {
  createRepositories,
  migrateDatabase,
  type Database,
  type QueryResult,
} from '../database';

type Row = Record<string, unknown>;

class MemoryDatabase implements Database {
  public readonly statements: string[] = [];
  public transactionCount = 0;
  public userVersion = 0;
  public foreignKeysEnabled = false;
  public failCursorAdvance = false;

  private state = {
    books: new Map<string, Row>(),
    outlineNodes: new Map<string, Row>(),
    cards: new Map<string, Row>(),
    messages: new Map<string, Row>(),
    generationStates: new Map<string, Row>(),
    ttsCache: new Map<string, Row>(),
  };

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.statements.push(sql);
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    if (normalized === 'PRAGMA FOREIGN_KEYS = ON') {
      this.foreignKeysEnabled = true;
      return {rows: [], rowsAffected: 0};
    }
    if (normalized === 'PRAGMA USER_VERSION') {
      return {rows: [{user_version: this.userVersion}], rowsAffected: 0};
    }
    if (normalized === 'PRAGMA USER_VERSION = 1') {
      this.userVersion = 1;
      return {rows: [], rowsAffected: 0};
    }
    if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX')) {
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
      const [id, bookId, parentId, title, level, body, childIds, status, chunkIndex] = params;
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
      });
      return {rows: [], rowsAffected: 1};
    }
    if (normalized.startsWith('INSERT INTO CARDS')) {
      const [id, bookId, sectionId, title, summary, body, keyPoints, sourceExcerpt, formulae, isFavorite, createdAt] = params;
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
    if (normalized.startsWith('INSERT INTO CHAT_MESSAGES')) {
      const [id, cardId, role, content, citations, createdAt] = params;
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
      const [sectionId, status, nextChunkIndex, errorMessage, updatedAt] = params;
      this.state.generationStates.set(sectionId as string, {
        section_id: sectionId,
        status,
        next_chunk_index: nextChunkIndex,
        error_message: errorMessage,
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
      const [status, chunkIndex, sectionId] = params;
      const node = this.state.outlineNodes.get(sectionId as string);
      if (node) {
        node.status = status;
        node.chunk_index = chunkIndex;
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
    const copyRows = (rows: Map<string, Row>) =>
      new Map(Array.from(rows, ([key, row]) => [key, {...row}]));
    const snapshot = {
      books: copyRows(this.state.books),
      outlineNodes: copyRows(this.state.outlineNodes),
      cards: copyRows(this.state.cards),
      messages: copyRows(this.state.messages),
      generationStates: copyRows(this.state.generationStates),
      ttsCache: copyRows(this.state.ttsCache),
    };
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
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
  title: 'Card',
  summary: 'A short summary',
  body: 'The explanation',
  keyPoints: ['one', 'two'],
  sourceExcerpt: 'Excerpt',
  formulae: ['x = y'],
  isFavorite: false,
  createdAt: '2026-07-12T00:00:00.000Z',
};

async function createReadyRepositories(database = new MemoryDatabase()) {
  await migrateDatabase(database);
  return {database, repositories: createRepositories(database)};
}

describe('SQLite repositories', () => {
  it('applies version 1 migration with foreign keys enabled', async () => {
    const database = new MemoryDatabase();

    await migrateDatabase(database);

    expect(database.foreignKeysEnabled).toBe(true);
    expect(database.userVersion).toBe(1);
    expect(database.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS books');
    expect(database.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS tts_cache');
  });

  it('round trips JSON array fields for books and cards', async () => {
    const {repositories} = await createReadyRepositories();

    await repositories.insertBook(book);
    await repositories.insertCard(card);

    await expect(repositories.getBook(book.id)).resolves.toMatchObject({tags: ['math', 'notes']});
    await expect(repositories.listCards(book.id)).resolves.toEqual([card]);
  });

  it('toggles a card favorite and returns its new value', async () => {
    const {repositories} = await createReadyRepositories();
    await repositories.insertCard(card);

    await expect(repositories.toggleFavorite(card.id)).resolves.toBe(true);
    await expect(repositories.listCards(book.id)).resolves.toMatchObject([{isFavorite: true}]);
  });

  it('persists and retrieves the last-read card for a book', async () => {
    const {repositories} = await createReadyRepositories();
    await repositories.insertBook(book);

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
      updatedAt: card.createdAt,
    });
    database.failCursorAdvance = true;

    await expect(repositories.saveCardsAndAdvance(card.sectionId, [card], 1)).rejects.toThrow('cursor advance failed');

    await expect(repositories.listCards(book.id)).resolves.toEqual([]);
  });

  it('saves cards and advances an absent generation cursor atomically', async () => {
    const {database, repositories} = await createReadyRepositories();

    await repositories.saveCardsAndAdvance(card.sectionId, [card], 2);

    await expect(repositories.listCards(book.id)).resolves.toEqual([card]);
    await expect(repositories.getGenerationState(card.sectionId)).resolves.toMatchObject({
      status: 'completed',
      nextChunkIndex: 2,
    });
    expect(database.transactionCount).toBe(1);
  });

  it('rejects a negative generation cursor before opening a transaction', async () => {
    const {database, repositories} = await createReadyRepositories();

    await expect(repositories.saveCardsAndAdvance(card.sectionId, [card], -1)).rejects.toThrow('Invalid generation cursor');

    expect(database.transactionCount).toBe(0);
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
