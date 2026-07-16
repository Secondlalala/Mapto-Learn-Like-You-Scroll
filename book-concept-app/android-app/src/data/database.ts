export interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
}

export interface Database {
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  transaction<T>(work: (database: Database) => Promise<T>): Promise<T>;
}

type NativeResultSet = {
  rows: {length: number; item(index: number): Record<string, unknown>};
  rowsAffected: number;
};

type NativeDatabase = {
  executeSql(sql: string, params?: unknown[]): Promise<[NativeResultSet]>;
  sqlBatch(statements: Array<[string, unknown[]]>): Promise<void>;
};

type NativeSQLite = {
  enablePromise(enabled: boolean): void;
  openDatabase(config: {name: string; location: 'default'}): Promise<NativeDatabase>;
};

class AndroidSQLiteDatabase implements Database {
  constructor(private readonly database: NativeDatabase) {}

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const [result] = await this.database.executeSql(sql, params);
    const rows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < result.rows.length; index += 1) {
      rows.push(result.rows.item(index));
    }
    return {rows, rowsAffected: result.rowsAffected};
  }

  async transaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
    const statements: Array<[string, unknown[]]> = [];
    const batchDatabase: Database = {
      execute: async (sql, params = []) => {
        statements.push([sql, params]);
        return {rows: [], rowsAffected: 0};
      },
      transaction: async nestedWork => nestedWork(batchDatabase),
    };
    const result = await work(batchDatabase);
    await this.database.sqlBatch(statements);
    return result;
  }
}

const migrationV1 = [
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    source_uri TEXT,
    original_text TEXT NOT NULL,
    tags TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_read_card_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS outline_nodes (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES outline_nodes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    level INTEGER NOT NULL,
    body TEXT NOT NULL,
    child_ids TEXT NOT NULL,
    status TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    start_offset INTEGER NOT NULL DEFAULT 0,
    end_offset INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body TEXT NOT NULL,
    key_points TEXT NOT NULL,
    source_excerpt TEXT NOT NULL,
    formulae TEXT NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generation_state (
    section_id TEXT PRIMARY KEY NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    next_chunk_index INTEGER NOT NULL,
    error_message TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tts_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    file_path TEXT NOT NULL,
    voice TEXT NOT NULL,
    speed REAL NOT NULL,
    model_version TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS cards_book_id_idx ON cards(book_id)',
  'CREATE INDEX IF NOT EXISTS chat_messages_card_id_idx ON chat_messages(card_id)',
];

const migrationV2 = [
  'ALTER TABLE outline_nodes ADD COLUMN start_offset INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE outline_nodes ADD COLUMN end_offset INTEGER NOT NULL DEFAULT 0',
];

export async function migrateDatabase(database: Database): Promise<void> {
  await database.execute('PRAGMA foreign_keys = ON');
  const version = await database.execute('PRAGMA user_version');
  const userVersion = Number(version.rows[0]?.user_version ?? 0);
  if (userVersion < 2) {
    const migration = userVersion < 1 ? migrationV1 : migrationV2;
    await database.transaction(async transaction => {
      for (const statement of migration) {
        await transaction.execute(statement);
      }
      await transaction.execute('PRAGMA user_version = 2');
    });
  }
}

let databasePromise: Promise<Database> | null = null;

export async function openDatabase(): Promise<Database> {
  if (!databasePromise) {
    const initialization = (async () => {
      const sqlite = require('react-native-sqlite-storage') as NativeSQLite;
      sqlite.enablePromise(true);
      const nativeDatabase = await sqlite.openDatabase({name: 'map-to-learn.db', location: 'default'});
      const database = new AndroidSQLiteDatabase(nativeDatabase);
      await migrateDatabase(database);
      return database;
    })();
    databasePromise = initialization;
    initialization.catch(() => {
      if (databasePromise === initialization) {
        databasePromise = null;
      }
    });
  }
  return databasePromise;
}

export {createRepositories} from './repositories';
