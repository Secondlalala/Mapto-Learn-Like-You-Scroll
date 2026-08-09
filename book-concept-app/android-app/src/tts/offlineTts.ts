import {NativeModules} from 'react-native';
import type {TtsCacheEntry} from '../domain/models';
import type {TtsPreferences} from '../settings/ttsPreferences';

export const OFFLINE_TTS_MODEL_VERSION = 'sherpa-onnx-1.13.4-aishell3';

export interface OfflineTtsStatus {
  modelVersion: string;
  sampleRate: number;
  numSpeakers: number;
}

export interface OfflineSpeakResult {
  cacheKey: string;
  filePath: string;
  cacheHit: boolean;
}

export interface NativeTtsAdapter {
  preload(): Promise<OfflineTtsStatus>;
  speakOffline(text: string, speed: number, speakerId: number): Promise<OfflineSpeakResult>;
  speakSystem(text: string, speed: number): Promise<null>;
  stop(): Promise<null>;
}

interface Dependencies {
  native: NativeTtsAdapter;
  getPreferences(): Promise<TtsPreferences>;
  repositories: {
    upsertTtsCache(entry: TtsCacheEntry): Promise<void>;
  };
}

export interface TtsService {
  preload(): Promise<OfflineTtsStatus>;
  speak(text: string): Promise<OfflineSpeakResult | null>;
  stop(): Promise<void>;
}

const SPEAKER_IDS = {
  'zh-female': 33,
  'zh-male': 21,
} as const;

function nativeAdapter(): NativeTtsAdapter {
  const module = NativeModules.MapToLearnTts as NativeTtsAdapter | undefined;
  if (!module) {
    throw new Error('内置中文语音模块未安装，请重新安装完整 APK。');
  }
  return module;
}

export function createOfflineTtsService(dependencies: Dependencies): TtsService {
  return {
    preload: () => dependencies.native.preload(),

    async speak(text) {
      const cleanText = text.trim();
      if (!cleanText) {
        throw new Error('朗读内容不能为空');
      }
      const preferences = await dependencies.getPreferences();
      if (preferences.engine === 'system') {
        await dependencies.native.speakSystem(cleanText, preferences.speed);
        return null;
      }

      const result = await dependencies.native.speakOffline(
        cleanText,
        preferences.speed,
        SPEAKER_IDS[preferences.voice],
      );
      const now = new Date().toISOString();
      await dependencies.repositories.upsertTtsCache({
        cacheKey: result.cacheKey,
        filePath: result.filePath,
        voice: preferences.voice,
        speed: preferences.speed,
        modelVersion: OFFLINE_TTS_MODEL_VERSION,
        settings: {engine: preferences.engine, speakerId: SPEAKER_IDS[preferences.voice]},
        createdAt: now,
        lastAccessedAt: now,
      });
      return result;
    },

    async stop() {
      await dependencies.native.stop();
    },
  };
}

export function createNativeTtsService(
  getPreferences: () => Promise<TtsPreferences>,
  repositories: Dependencies['repositories'],
): TtsService {
  const lazyNative: NativeTtsAdapter = {
    preload: () => nativeAdapter().preload(),
    speakOffline: (text, speed, speakerId) => nativeAdapter().speakOffline(text, speed, speakerId),
    speakSystem: (text, speed) => nativeAdapter().speakSystem(text, speed),
    stop: () => nativeAdapter().stop(),
  };
  return createOfflineTtsService({native: lazyNative, getPreferences, repositories});
}
