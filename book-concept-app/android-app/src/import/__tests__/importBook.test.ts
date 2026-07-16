import type {Repositories} from '../../data/repositories';
import {createBookImporter} from '../importBook';

function createDependencies(
  bytes = new Uint8Array([0x23, 0x20, 0xe7, 0xac, 0xac, 0xe4, 0xb8, 0x80, 0xe7, 0xab, 0xa0, 0x0a, 0xe6, 0xad, 0xa3, 0xe6, 0x96, 0x87]),
) {
  const events: string[] = [];
  const repositories = {
    insertBookWithOutline: jest.fn(async () => {
      events.push('database');
    }),
  } as unknown as Pick<Repositories, 'insertBookWithOutline'>;
  const dependencies = {
    getDisplayName: jest.fn(async (uri: string) => uri.split('/').at(-1) ?? 'book.txt'),
    copyToDocuments: jest.fn(async () => {
      events.push('copy');
      return 'file:///documents/imported-book.md';
    }),
    readBytes: jest.fn(async () => {
      events.push('read');
      return bytes;
    }),
    repositories: jest.fn(async () => repositories),
    now: jest.fn(() => '2026-07-16T00:00:00.000Z'),
    createId: jest.fn(() => 'book-1'),
  };

  return {dependencies, repositories, events};
}

describe('createBookImporter', () => {
  it('accepts case-insensitive Markdown and persists its private copy after decoding', async () => {
    const {dependencies, repositories, events} = createDependencies();
    const importBook = createBookImporter(dependencies);

    await expect(importBook('content://books/INTRO.MD')).resolves.toMatchObject({
      id: 'book-1',
      title: 'INTRO',
      sourceUri: 'file:///documents/imported-book.md',
      originalText: '# 第一章\n正文',
    });

    expect(events).toEqual(['copy', 'read', 'database']);
    expect(repositories.insertBookWithOutline).toHaveBeenCalledWith(
      expect.objectContaining({id: 'book-1'}),
      [
        expect.objectContaining({
          id: 'book-1-section-1-0',
          bookId: 'book-1',
          parentId: null,
          title: '第一章',
          body: '正文',
          startOffset: 6,
          endOffset: 8,
        }),
      ],
    );
  });

  it('rejects unsupported files before copying bytes or writing database rows', async () => {
    const {dependencies, repositories} = createDependencies();
    const importBook = createBookImporter(dependencies);

    await expect(importBook('content://books/notes.pdf')).rejects.toThrow('Only Markdown and TXT files can be imported');

    expect(dependencies.copyToDocuments).not.toHaveBeenCalled();
    expect(dependencies.readBytes).not.toHaveBeenCalled();
    expect(repositories.insertBookWithOutline).not.toHaveBeenCalled();
  });

  it('imports an empty file with a zero-width outline node', async () => {
    const {dependencies, repositories} = createDependencies(new Uint8Array());
    const importBook = createBookImporter(dependencies);

    await importBook('content://books/empty.txt');

    expect(repositories.insertBookWithOutline).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({body: '', startOffset: 0, endOffset: 0})],
    );
  });
});
