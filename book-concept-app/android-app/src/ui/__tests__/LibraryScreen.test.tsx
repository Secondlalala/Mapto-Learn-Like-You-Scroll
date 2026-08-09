import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import LibraryScreen from '../screens/LibraryScreen';
import {book, cards, outline} from '../testFixtures';

it('imports a Markdown book and refreshes the persisted library', async () => {
  const repositories = {
    listBooks: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([book]),
    listCards: jest.fn().mockResolvedValue(cards),
    listOutlineNodes: jest.fn().mockResolvedValue(outline),
    getLastReadCard: jest.fn().mockResolvedValue('card-2'),
  };
  const pickBookUri = jest.fn().mockResolvedValue('content://book.md');
  const importBook = jest.fn().mockResolvedValue(book);
  render(
    <LibraryScreen
      dependencies={{repositories, pickBookUri, importBook}}
      onOpenBook={jest.fn()}
    />,
  );

  expect(await screen.findByText('还没有导入书籍')).toBeTruthy();
  fireEvent.press(screen.getByText('导入 Markdown / TXT'));

  await waitFor(() => expect(importBook).toHaveBeenCalledWith('content://book.md'));
  expect(await screen.findByText('量子场论讲义')).toBeTruthy();
  expect(screen.getByText(/3 张卡片/)).toBeTruthy();
});

it('opens the saved reading position from a library row', async () => {
  const onOpenBook = jest.fn();
  render(
    <LibraryScreen
      dependencies={{
        repositories: {
          listBooks: jest.fn().mockResolvedValue([book]),
          listCards: jest.fn().mockResolvedValue(cards),
          listOutlineNodes: jest.fn().mockResolvedValue(outline),
          getLastReadCard: jest.fn().mockResolvedValue('card-2'),
        },
        pickBookUri: jest.fn(),
        importBook: jest.fn(),
      }}
      onOpenBook={onOpenBook}
    />,
  );

  fireEvent.press(await screen.findByText('继续阅读'));
  expect(onOpenBook).toHaveBeenCalledWith(book.id);
});
