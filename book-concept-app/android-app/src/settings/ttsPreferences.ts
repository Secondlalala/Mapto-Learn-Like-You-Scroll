export type TtsEngine = 'offline' | 'system';
export type ChineseVoice = 'zh-female' | 'zh-male';

export interface TtsPreferences {
  engine: TtsEngine;
  voice: ChineseVoice;
  speed: number;
}

export interface PreferencesAdapter {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export const DEFAULT_TTS_PREFERENCES: TtsPreferences = {
  engine: 'offline',
  voice: 'zh-female',
  speed: 0.8,
};

const SERVICE = 'map-to-learn.tts-preferences';

const nativeAdapter: PreferencesAdapter = {
  async read() {
    const keychain = require('react-native-keychain') as {
      getGenericPassword(options: {service: string}): Promise<false | {password: string}>;
    };
    const result = await keychain.getGenericPassword({service: SERVICE});
    return result === false ? null : result.password;
  },
  async write(value) {
    const keychain = require('react-native-keychain') as {
      setGenericPassword(username: string, password: string, options: {service: string}): Promise<unknown>;
    };
    await keychain.setGenericPassword('tts', value, {service: SERVICE});
  },
};

function validate(value: TtsPreferences): TtsPreferences {
  if (value.engine !== 'offline' && value.engine !== 'system') {
    throw new Error('请选择有效的语音引擎');
  }
  if (value.voice !== 'zh-female' && value.voice !== 'zh-male') {
    throw new Error('请选择有效的中文音色');
  }
  if (!Number.isFinite(value.speed) || value.speed < 0.2 || value.speed > 2) {
    throw new Error('语速需在 0.2 到 2.0 之间');
  }
  return {...value, speed: Math.round(value.speed * 10) / 10};
}

export function createTtsPreferencesStore(adapter: PreferencesAdapter = nativeAdapter) {
  return {
    async getTtsPreferences(): Promise<TtsPreferences> {
      const stored = await adapter.read();
      if (!stored) {return DEFAULT_TTS_PREFERENCES;}
      try {
        return validate({...DEFAULT_TTS_PREFERENCES, ...JSON.parse(stored)});
      } catch {
        return DEFAULT_TTS_PREFERENCES;
      }
    },
    async setTtsPreferences(value: TtsPreferences): Promise<void> {
      await adapter.write(JSON.stringify(validate(value)));
    },
  };
}

const defaultStore = createTtsPreferencesStore();
export const getTtsPreferences = defaultStore.getTtsPreferences;
export const setTtsPreferences = defaultStore.setTtsPreferences;
