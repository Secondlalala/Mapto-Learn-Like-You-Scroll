import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import {BackHandler} from 'react-native';
import AppNavigator from '../navigation/AppNavigator';

function dependencies() {
  return {
    repositories: {
      listBooks: jest.fn().mockResolvedValue([]), listCards: jest.fn().mockResolvedValue([]),
      listOutlineNodes: jest.fn().mockResolvedValue([]), getLastReadCard: jest.fn().mockResolvedValue(null),
      getBook: jest.fn().mockResolvedValue(null), setLastReadCard: jest.fn(), toggleFavorite: jest.fn(),
      listFavoriteCards: jest.fn().mockResolvedValue([]), getGenerationState: jest.fn().mockResolvedValue(null),
      getCardScrollOffset: jest.fn().mockResolvedValue(0), setCardScrollOffset: jest.fn(),
    },
    pickBookUri: jest.fn(), importBook: jest.fn(), generateNextSection: jest.fn(), generateSection: jest.fn(),
    getDeepSeekSettings: jest.fn().mockRejectedValue(new Error('not configured')),
    setDeepSeekSettings: jest.fn(),
    getTtsPreferences: jest.fn().mockResolvedValue({engine: 'offline', voice: 'zh-female', speed: 0.8}),
    setTtsPreferences: jest.fn(),
  };
}

it('provides compact Library, Reader, Favorites, and Settings tabs', async () => {
  const consoleError = jest.spyOn(console, 'error');
  render(<AppNavigator dependencies={dependencies()} />);
  expect(await screen.findByText('我的书库')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('设置'));
  expect(await screen.findByText('DeepSeek')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('收藏'));
  expect(await screen.findByText('我的收藏')).toBeTruthy();
  await act(async () => { await new Promise<void>(resolve => setTimeout(() => resolve(), 0)); });
  expect(consoleError.mock.calls.filter(call => String(call[0]).includes('Animated')).length).toBe(0);
  consoleError.mockRestore();
});

it('uses Android back navigation history instead of exiting from a secondary tab', async () => {
  const handlers: Array<() => boolean | null | undefined> = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {remove: jest.fn()};
  });
  render(<AppNavigator dependencies={dependencies()} />);
  await screen.findByText('我的书库');
  fireEvent.press(screen.getByLabelText('设置'));
  await screen.findByText('DeepSeek');

  expect(handlers.length).toBeGreaterThan(0);
  act(() => { handlers.at(-1)?.(); });

  expect(await screen.findByText('我的书库')).toBeTruthy();
});
