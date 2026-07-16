import {createRepositories} from '../data/repositories';
import {openDatabase} from '../data/database';
import type {Book, OutlineNode} from '../domain/models';
import {decodeBook} from './textDecoder';
import {parseOutline, splitOversizedSection} from './outlineParser';

type ImportRepository = Pick<ReturnType<typeof createRepositories>, 'insertBookWithOutline'>;

export interface ImportDependencies {
  getDisplayName(uri: string): Promise<string>;
  copyToDocuments(uri: string, fileName: string): Promise<string>;
  readBytes(uri: string): Promise<Uint8Array>;
  repositories(): Promise<ImportRepository>;
  now(): string;
  createId(): string;
}

function extensionFor(fileName: string): string | null {
  const match = /\.([^.]+)$/.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : null;
}

function titleFor(fileName: string): string {
  const extension = extensionFor(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function createOutlineNodes(bookId: string, text: string): OutlineNode[] {
  const sections = parseOutline(text);
  const nodeIds = new Map<string, string>();
  for (const section of sections) {
    nodeIds.set(section.id, `${bookId}-${section.id}-0`);
  }

  const nodes: OutlineNode[] = [];
  for (const section of sections) {
    const chunks = splitOversizedSection(section);
    for (const chunk of chunks) {
      const id = `${bookId}-${section.id}-${chunk.index}`;
      nodes.push({
        id,
        bookId,
        parentId: chunk.index === 0 ? (section.parentId ? nodeIds.get(section.parentId) ?? null : null) : nodeIds.get(section.id) ?? null,
        title: section.title,
        level: chunk.index === 0 ? section.level : section.level + 1,
        body: chunk.text,
        childIds: [],
        status: 'queued',
        chunkIndex: chunk.index,
      });
    }
  }
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    if (node.parentId) {
      nodesById.get(node.parentId)?.childIds.push(node.id);
    }
  }
  return nodes;
}

export function createBookImporter(dependencies: ImportDependencies): (uri: string) => Promise<Book> {
  return async uri => {
    const fileName = await dependencies.getDisplayName(uri);
    const extension = extensionFor(fileName);
    if (extension !== '.md' && extension !== '.txt') {
      throw new Error('Only Markdown and TXT files can be imported');
    }

    const sourceUri = await dependencies.copyToDocuments(uri, fileName);
    const decoded = decodeBook(await dependencies.readBytes(sourceUri));
    const now = dependencies.now();
    const book: Book = {
      id: dependencies.createId(),
      title: titleFor(fileName),
      author: null,
      sourceUri,
      originalText: decoded.text,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await (await dependencies.repositories()).insertBookWithOutline(book, createOutlineNodes(book.id, decoded.text));
    return book;
  };
}

const pickedNames = new Map<string, string>();

function fileNameFromUri(uri: string): string {
  const withoutQuery = uri.split('?')[0];
  const name = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  return decodeURIComponent(name || 'book.txt');
}

function decodeBase64(base64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleaned = base64.replace(/\s/g, '').replace(new RegExp('=+$'), '');
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const character of cleaned) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) {
      throw new Error('Invalid base64 file content');
    }
    value = value * 64 + digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(Math.floor(value / 2 ** bits));
      value %= 2 ** bits;
    }
  }
  return new Uint8Array(bytes);
}

export async function pickBookUri(): Promise<string> {
  const picker = require('@react-native-documents/picker') as {
    pick(options: {type: string[]; allowMultiSelection: boolean}): Promise<Array<{uri: string; name: string | null}>>;
  };
  const [file] = await picker.pick({type: ['text/plain', 'text/markdown'], allowMultiSelection: false});
  if (!file) {
    throw new Error('No book file selected');
  }
  pickedNames.set(file.uri, file.name ?? fileNameFromUri(file.uri));
  return file.uri;
}

const defaultDependencies: ImportDependencies = {
  async getDisplayName(uri) {
    return pickedNames.get(uri) ?? fileNameFromUri(uri);
  },
  async copyToDocuments(uri, fileName) {
    const picker = require('@react-native-documents/picker') as {
      keepLocalCopy(options: {
        files: Array<{uri: string; fileName: string}>;
        destination: 'documentDirectory';
      }): Promise<Array<{status: string; localUri?: string; copyError?: string}>>;
    };
    const [copy] = await picker.keepLocalCopy({
      files: [{uri, fileName}],
      destination: 'documentDirectory',
    });
    if (!copy || copy.status !== 'success' || !copy.localUri) {
      throw new Error(copy?.copyError ?? 'Unable to copy selected book');
    }
    return copy.localUri;
  },
  async readBytes(uri) {
    const {FileSystem} = require('react-native-file-access') as {
      FileSystem: {readFile(path: string, encoding: 'base64'): Promise<string>};
    };
    return decodeBase64(await FileSystem.readFile(uri, 'base64'));
  },
  async repositories() {
    return createRepositories(await openDatabase());
  },
  now: () => new Date().toISOString(),
  createId: () => {
    const crypto = (globalThis as unknown as {crypto?: {randomUUID?: () => string}}).crypto;
    return crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  },
};

export const importBook = createBookImporter(defaultDependencies);
