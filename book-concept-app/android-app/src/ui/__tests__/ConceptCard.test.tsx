import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import ConceptCard from '../components/ConceptCard';
import {cards} from '../testFixtures';

it('restores and saves the latest card offset at drag and momentum boundaries without duplicate writes', () => {
  const onScrollOffset = jest.fn();
  render(
    <ConceptCard
      card={cards[0]}
      height={600}
      initialScrollOffset={135}
      onScrollOffset={onScrollOffset}
      onToggleFavorite={jest.fn()}
    />,
  );

  const scroll = screen.getByTestId('card-scroll-card-1');
  expect(scroll.props.contentOffset).toEqual({x: 0, y: 135});
  expect(scroll.props.nestedScrollEnabled).toBe(true);
  fireEvent(scroll, 'scroll', {nativeEvent: {contentOffset: {x: 0, y: 246}}});
  expect(onScrollOffset).not.toHaveBeenCalled();
  fireEvent(scroll, 'scrollEndDrag', {nativeEvent: {contentOffset: {x: 0, y: 246}}});
  expect(onScrollOffset).toHaveBeenCalledTimes(1);
  fireEvent(scroll, 'momentumScrollEnd', {nativeEvent: {contentOffset: {x: 0, y: 246}}});
  expect(onScrollOffset).toHaveBeenCalledWith(cards[0], 246);
  expect(onScrollOffset).toHaveBeenCalledTimes(1);
});

it('flushes the latest observed offset when the card unmounts', () => {
  const onScrollOffset = jest.fn();
  const view = render(
    <ConceptCard
      card={cards[0]}
      height={600}
      initialScrollOffset={0}
      onScrollOffset={onScrollOffset}
      onToggleFavorite={jest.fn()}
    />,
  );

  fireEvent(view.getByTestId('card-scroll-card-1'), 'scroll', {
    nativeEvent: {contentOffset: {x: 0, y: 321}},
  });
  expect(onScrollOffset).not.toHaveBeenCalled();
  view.unmount();

  expect(onScrollOffset).toHaveBeenCalledTimes(1);
  expect(onScrollOffset).toHaveBeenCalledWith(cards[0], 321);
});
