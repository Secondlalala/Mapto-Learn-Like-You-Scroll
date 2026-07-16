import type {
  Book,
  ChatMessage,
  ConceptCard,
  GenerationState,
  TtsCacheEntry,
} from '../domain/models';
import {openDatabase, type Database} from './database';

type Row = Record<string, unknown>;

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function fromJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    return {};
  }
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return String(value ?? '');
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toBook(row: Row): Book {
  return {
    id: asString(row.id),
    title: asString(row.title),
    author: asNullableString(row.author),
    sourceUri: asNullableString(row.source_uri),
    originalText: asString(row.original_text),
    tags: fromJsonArray(row.tags),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function toCard(row: Row): ConceptCard {
  return {
    id: asString(row.id),
    bookId: asString(row.book_id),
    sectionId: asString(row.section_id),
    title: asString(row.title),
    summary: asString(row.summary),
    body: asString(row.body),
    keyPoints: fromJsonArray(row.key_points),
    sourceExcerpt: asString(row.source_excerpt),
    formulae: fromJsonArray(row.formulae),
    isFavorite: Number(row.is_favorite) === 1,
    createdAt: asString(row.created_at),
  };
}

function toMessage(row: Row): ChatMessage {
  return {
    id: asString(row.id),
    cardId: asString(row.card_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: asString(row.content),
    citations: fromJsonArray(row.citations),
    createdAt: asString(row.created_at),
  };
}

function toGenerationState(row: Row): GenerationState {
  return {
    sectionId: asString(row.section_id),
    status: asString(row.status) as GenerationState['status'],
    nextChunkIndex: Number(row.next_chunk_index),
    errorMessage: asNullableString(row.error_message),
    updatedAt: asString(row.updated_at),
  };
}

function toTtsCacheEntry(row: Row): TtsCacheEntry {
  return {
    cacheKey: asString(row.cache_key),
    filePath: asString(row.file_path),
    voice: asString(row.voice),
    speed: Number(row.speed),
    modelVersion: asString(row.model_version),
    settings: fromJsonObject(row.settings),
    createdAt: asString(row.created_at),
    lastAccessedAt: asString(row.last_accessed_at),
  };
}

async function insertCard(database: Database, card: ConceptCard): Promise<void> {
  await database.execute(
    `INSERT INTO cards (
      id, book_id, section_id, title, summary, body, key_points, source_excerpt, formulae, is_favorite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      card.id,
      card.bookId,
      card.sectionId,
      card.title,
      card.summary,
      card.body,
      toJson(card.keyPoints),
      card.sourceExcerpt,
      toJson(card.formulae),
      card.isFavorite ? 1 : 0,
      card.createdAt,
    ],
  );
}

export interface Repositories {
  listBooks(): Promise<Book[]>;
  getBook(id: string): Promise<Book | null>;
  insertBook(book: Book): Promise<void>;
  insertCard(card: ConceptCard): Promise<void>;
  listCards(bookId: string): Promise<ConceptCard[]>;
  toggleFavorite(cardId: string): Promise<boolean>;
  listMessages(cardId: string): Promise<ChatMessage[]>;
  insertMessage(message: ChatMessage): Promise<void>;
  getGenerationState(sectionId: string): Promise<GenerationState | null>;
  setGenerationState(state: GenerationState): Promise<void>;
  saveCardsAndAdvance(sectionId: string, cards: ConceptCard[], nextChunkIndex: number): Promise<void>;
  setLastReadCard(bookId: string, cardId: string): Promise<void>;
  getLastReadCard(bookId: string): Promise<string | null>;
  upsertTtsCache(entry: TtsCacheEntry): Promise<void>;
  getTtsCache(cacheKey: string): Promise<TtsCacheEntry | null>;
}

export function createRepositories(database: Database): Repositories {
  return {
    async listBooks() {
      const result = await database.execute('SELECT * FROM books ORDER BY updated_at DESC');
      return result.rows.map(toBook);
    },

    async getBook(id) {
      const result = await database.execute('SELECT * FROM books WHERE id = ?', [id]);
      return result.rows[0] ? toBook(result.rows[0]) : null;
    },

    async insertBook(book) {
      await database.execute(
        `INSERT INTO books (
          id, title, author, source_uri, original_text, tags, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          book.id,
          book.title,
          book.author,
          book.sourceUri,
          book.originalText,
          toJson(book.tags),
          book.createdAt,
          book.updatedAt,
        ],
      );
    },

    insertCard: card => insertCard(database, card),

    async listCards(bookId) {
      const result = await database.execute('SELECT * FROM cards WHERE book_id = ? ORDER BY created_at ASC', [bookId]);
      return result.rows.map(toCard);
    },

    async toggleFavorite(cardId) {
      const current = await database.execute('SELECT is_favorite FROM cards WHERE id = ?', [cardId]);
      if (!current.rows[0]) {
        throw new Error(`Card not found: ${cardId}`);
      }
      const isFavorite = Number(current.rows[0].is_favorite) !== 1;
      await database.execute('UPDATE cards SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, cardId]);
      return isFavorite;
    },

    async listMessages(cardId) {
      const result = await database.execute('SELECT * FROM chat_messages WHERE card_id = ? ORDER BY created_at ASC', [cardId]);
      return result.rows.map(toMessage);
    },

    async insertMessage(message) {
      await database.execute(
        'INSERT INTO chat_messages (id, card_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [message.id, message.cardId, message.role, message.content, toJson(message.citations), message.createdAt],
      );
    },

    async getGenerationState(sectionId) {
      const result = await database.execute('SELECT * FROM generation_state WHERE section_id = ?', [sectionId]);
      return result.rows[0] ? toGenerationState(result.rows[0]) : null;
    },

    async setGenerationState(state) {
      await database.execute(
        `INSERT INTO generation_state (section_id, status, next_chunk_index, error_message, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(section_id) DO UPDATE SET
           status = excluded.status,
           next_chunk_index = excluded.next_chunk_index,
           error_message = excluded.error_message,
           updated_at = excluded.updated_at`,
        [state.sectionId, state.status, state.nextChunkIndex, state.errorMessage, state.updatedAt],
      );
    },

    async saveCardsAndAdvance(sectionId, cards, nextChunkIndex) {
      if (nextChunkIndex < 0) {
        throw new Error('Invalid generation cursor');
      }
      const updatedAt = new Date().toISOString();
      await database.transaction(async transaction => {
        for (const card of cards) {
          await insertCard(transaction, card);
        }
        await transaction.execute(
          `INSERT INTO generation_state (section_id, status, next_chunk_index, error_message, updated_at)
           VALUES (?, ?, ?, NULL, ?)
           ON CONFLICT(section_id) DO UPDATE SET
             status = excluded.status,
             next_chunk_index = excluded.next_chunk_index,
             error_message = NULL,
             updated_at = excluded.updated_at`,
          [sectionId, 'completed', nextChunkIndex, updatedAt],
        );
        await transaction.execute(
          'UPDATE outline_nodes SET status = ?, chunk_index = ? WHERE id = ?',
          ['completed', nextChunkIndex, sectionId],
        );
      });
    },

    async setLastReadCard(bookId, cardId) {
      await database.execute('UPDATE books SET last_read_card_id = ? WHERE id = ?', [cardId, bookId]);
    },

    async getLastReadCard(bookId) {
      const result = await database.execute('SELECT last_read_card_id FROM books WHERE id = ?', [bookId]);
      return asNullableString(result.rows[0]?.last_read_card_id);
    },

    async upsertTtsCache(entry) {
      await database.execute(
        `INSERT INTO tts_cache (
          cache_key, file_path, voice, speed, model_version, settings, created_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          file_path = excluded.file_path,
          voice = excluded.voice,
          speed = excluded.speed,
          model_version = excluded.model_version,
          settings = excluded.settings,
          last_accessed_at = excluded.last_accessed_at`,
        [
          entry.cacheKey,
          entry.filePath,
          entry.voice,
          entry.speed,
          entry.modelVersion,
          toJson(entry.settings),
          entry.createdAt,
          entry.lastAccessedAt,
        ],
      );
    },

    async getTtsCache(cacheKey) {
      const result = await database.execute('SELECT * FROM tts_cache WHERE cache_key = ?', [cacheKey]);
      return result.rows[0] ? toTtsCacheEntry(result.rows[0]) : null;
    },
  };
}

export async function saveCardsAndAdvance(
  sectionId: string,
  cards: ConceptCard[],
  nextChunkIndex: number,
): Promise<void> {
  const database = await openDatabase();
  await createRepositories(database).saveCardsAndAdvance(sectionId, cards, nextChunkIndex);
}
