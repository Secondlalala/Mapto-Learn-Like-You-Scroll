import React from 'react';
import {render, screen} from '@testing-library/react-native';
import App from '../App';
import {openDatabase} from '../data/database';

jest.mock('../data/database', () => ({
  openDatabase: jest.fn().mockResolvedValue(undefined),
}));

test('shows the mobile library as the initial screen', () => {
  render(<App />);
  expect(screen.getByText('我的书库')).toBeTruthy();
  expect(openDatabase).toHaveBeenCalledTimes(1);
});
