import {createOfflineTtsService} from '../offlineTts';

function dependencies(engine: 'offline' | 'system' = 'offline') {
  const native = {
    preload: jest.fn().mockResolvedValue({modelVersion: 'sherpa-onnx-1.13.4-aishell3', sampleRate: 22050, numSpeakers: 174}),
    speakOffline: jest.fn().mockResolvedValue({cacheKey: 'cache-key', filePath: '/cache/audio.wav', cacheHit: false}),
    speakSystem: jest.fn().mockResolvedValue(null),
    stop: jest.fn().mockResolvedValue(null),
  };
  const repositories = {upsertTtsCache: jest.fn().mockResolvedValue(undefined)};
  return {
    native,
    repositories,
    getPreferences: jest.fn().mockResolvedValue({engine, voice: 'zh-female', speed: 0.8}),
  };
}

it('preloads the bundled offline model', async () => {
  const deps = dependencies();
  const service = createOfflineTtsService(deps);

  await expect(service.preload()).resolves.toMatchObject({numSpeakers: 174});
  expect(deps.native.preload).toHaveBeenCalledTimes(1);
});

it('uses the female speaker and records generated audio in the local cache index', async () => {
  const deps = dependencies();
  const service = createOfflineTtsService(deps);

  await service.speak('寓言故事。');

  expect(deps.native.speakOffline).toHaveBeenCalledWith('寓言故事。', 0.8, 33);
  expect(deps.repositories.upsertTtsCache).toHaveBeenCalledWith(expect.objectContaining({
    cacheKey: 'cache-key',
    filePath: '/cache/audio.wav',
    voice: 'zh-female',
    speed: 0.8,
    modelVersion: 'sherpa-onnx-1.13.4-aishell3',
  }));
});

it('uses Android system speech without writing an offline cache entry', async () => {
  const deps = dependencies('system');
  const service = createOfflineTtsService(deps);

  await service.speak('系统语音。');

  expect(deps.native.speakSystem).toHaveBeenCalledWith('系统语音。', 0.8);
  expect(deps.native.speakOffline).not.toHaveBeenCalled();
  expect(deps.repositories.upsertTtsCache).not.toHaveBeenCalled();
});
