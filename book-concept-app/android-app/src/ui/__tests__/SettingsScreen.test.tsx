import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import SettingsScreen from '../screens/SettingsScreen';

function dependencies() {
  return {
    getDeepSeekSettings: jest.fn().mockResolvedValue({
      apiKey: 'secret-key-never-rendered', apiBase: 'https://api.deepseek.com',
      model: 'deepseek-chat', temperature: 0.3, timeoutMs: 30000,
    }),
    setDeepSeekSettings: jest.fn().mockResolvedValue(undefined),
    getTtsPreferences: jest.fn().mockResolvedValue({engine: 'offline', voice: 'zh-female', speed: 0.8}),
    setTtsPreferences: jest.fn().mockResolvedValue(undefined),
    preloadTts: jest.fn().mockResolvedValue({modelVersion: 'sherpa-onnx-1.13.4-aishell3', sampleRate: 22050, numSpeakers: 174}),
  };
}

it('never renders the stored API key and validates settings before save', async () => {
  const deps = dependencies();
  render(<SettingsScreen dependencies={deps} />);
  await screen.findByDisplayValue('deepseek-chat');
  expect(screen.queryByDisplayValue('secret-key-never-rendered')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('请求超时（毫秒）'), '200');
  fireEvent.press(screen.getByText('保存设置'));
  expect(await screen.findByText('请求超时需在 1000 到 120000 毫秒之间')).toBeTruthy();
  expect(deps.setDeepSeekSettings).not.toHaveBeenCalled();
});

it('persists DeepSeek and TTS choices including speed from 0.2 to 2.0', async () => {
  const deps = dependencies();
  render(<SettingsScreen dependencies={deps} />);
  await screen.findByDisplayValue('deepseek-chat');
  fireEvent.changeText(screen.getByLabelText('DeepSeek API Key'), 'new-key');
  fireEvent.press(screen.getByLabelText('语速增加'));
  fireEvent.press(screen.getByText('系统语音'));
  fireEvent.press(screen.getByText('保存设置'));
  await waitFor(() => expect(deps.setDeepSeekSettings).toHaveBeenCalledWith(expect.objectContaining({apiKey: 'new-key'})));
  expect(deps.setTtsPreferences).toHaveBeenCalledWith({engine: 'system', voice: 'zh-female', speed: 0.9});
  expect(screen.getByText('AISHELL-3 · 内置中文模型')).toBeTruthy();
});

it('persists a speed change immediately without pressing save', async () => {
  const deps = dependencies();
  render(<SettingsScreen dependencies={deps} />);
  await screen.findByDisplayValue('deepseek-chat');

  fireEvent.press(screen.getByLabelText('语速增加'));

  await waitFor(() => expect(deps.setTtsPreferences).toHaveBeenCalledWith({
    engine: 'offline',
    voice: 'zh-female',
    speed: 0.9,
  }));
  expect(screen.getByText('0.9×')).toBeTruthy();
  expect(screen.getByText('设置已保存')).toBeTruthy();
});

it('preloads the bundled Chinese model and reports readiness', async () => {
  const deps = dependencies();
  render(<SettingsScreen dependencies={deps} />);
  await screen.findByDisplayValue('deepseek-chat');

  fireEvent.press(screen.getByText('加载离线语音模型'));

  await waitFor(() => expect(deps.preloadTts).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('模型已就绪 · 174 个音色 · 22050 Hz')).toBeTruthy();
});

it('notifies the reader generation lifecycle after secure settings save', async () => {
  const deps = dependencies();
  const onSaved = jest.fn();
  render(<SettingsScreen dependencies={deps} onSaved={onSaved} />);
  await screen.findByDisplayValue('deepseek-chat');
  fireEvent.press(screen.getByText('保存设置'));
  await waitFor(() => expect(deps.setDeepSeekSettings).toHaveBeenCalled());
  expect(onSaved).toHaveBeenCalledTimes(1);
});
