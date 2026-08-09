import {createTtsPreferencesStore} from '../ttsPreferences';

it('persists validated TTS choices and restores the last speed', async () => {
  let stored: string | null = null;
  const store = createTtsPreferencesStore({
    read: async () => stored,
    write: async value => { stored = value; },
  });

  await store.setTtsPreferences({engine: 'system', voice: 'zh-male', speed: 1.4});
  await expect(store.getTtsPreferences()).resolves.toEqual({engine: 'system', voice: 'zh-male', speed: 1.4});
});

it('rejects a TTS speed outside 0.2 to 2.0', async () => {
  const store = createTtsPreferencesStore({read: async () => null, write: async () => undefined});
  await expect(store.setTtsPreferences({engine: 'offline', voice: 'zh-female', speed: 2.1})).rejects.toThrow('0.2');
});
