import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import OutlineDrawer from '../components/OutlineDrawer';
import {outline} from '../testFixtures';

it('collapses nested sections and displays generation status and progress', () => {
  render(<OutlineDrawer nodes={outline} activeSectionId="section-1" generating onSelect={jest.fn()} onClose={jest.fn()} />);

  expect(screen.getByText('1.1 经典场')).toBeTruthy();
  expect(screen.getByText('已完成 1 / 2')).toBeTruthy();
  expect(screen.getByText('正在生成下一节')).toBeTruthy();
  expect(screen.getByText('待生成')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('折叠 第一章 为什么需要场'));
  expect(screen.queryByText('1.1 经典场')).toBeNull();
});
