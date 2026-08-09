import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import App from '../App';
import {openDatabase} from '../data/database';

jest.mock('../data/database', () => ({openDatabase: jest.fn().mockResolvedValue(undefined)}));
jest.mock('../ui/navigation/AppNavigator', () => {
  const ReactModule = require('react');
  const {Text} = require('react-native');
  return function MockNavigator() { return ReactModule.createElement(Text, null, '我的书库'); };
});

const mockOpenDatabase = jest.mocked(openDatabase);
beforeEach(() => mockOpenDatabase.mockReset());

test('shows the mobile library as the initial screen', async () => {
  mockOpenDatabase.mockResolvedValue(undefined as never);
  render(<App />);
  expect(await screen.findByText('我的书库')).toBeTruthy();
  await waitFor(() => expect(openDatabase).toHaveBeenCalledTimes(1));
});

test('shows a non-crashing database failure with a retry action', async () => {
  mockOpenDatabase.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(undefined as never);
  render(<App />);
  expect(await screen.findByText('本地数据库初始化失败')).toBeTruthy();
  fireEvent.press(screen.getByText('重试'));
  await waitFor(() => expect(openDatabase).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText('本地数据库初始化失败')).toBeNull());
});
