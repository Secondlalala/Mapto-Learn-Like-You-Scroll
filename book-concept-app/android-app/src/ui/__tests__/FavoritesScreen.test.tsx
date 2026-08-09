import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import FavoritesScreen from '../screens/FavoritesScreen';
import {cards} from '../testFixtures';

it('lists local favorites and removes a toggled card', async () => {
  const favorite = {...cards[0], isFavorite: true};
  const repositories = {
    listFavoriteCards: jest.fn().mockResolvedValueOnce([favorite]).mockResolvedValueOnce([]),
    toggleFavorite: jest.fn().mockResolvedValue(false),
  };
  render(<FavoritesScreen repositories={repositories} onOpenCard={jest.fn()} />);

  expect(await screen.findByText('本章导览')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('取消收藏 本章导览'));
  await waitFor(() => expect(repositories.toggleFavorite).toHaveBeenCalledWith(favorite.id));
  expect(await screen.findByText('还没有收藏卡片')).toBeTruthy();
});
