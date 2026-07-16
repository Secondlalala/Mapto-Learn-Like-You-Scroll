export interface DeepSeekSettings {
  apiKey: string;
  apiBase: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

export interface SecureSettingsAdapter {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

type NativeKeychain = {
  getGenericPassword(options: {service: string}): Promise<false | {password: string}>;
  setGenericPassword(username: string, password: string, options: {service: string}): Promise<unknown>;
};

const SERVICE = 'map-to-learn.deepseek';

export const DEFAULT_DEEPSEEK_SETTINGS = {
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.3,
  timeoutMs: 30_000,
} as const;

export class DeepSeekSettingsValidationError extends Error {
  readonly code = 'deepseek_settings_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekSettingsValidationError';
  }
}

export class DeepSeekNotConfiguredError extends Error {
  readonly code = 'deepseek_not_configured';

  constructor() {
    super('Configure a DeepSeek API key in settings before generating content.');
    this.name = 'DeepSeekNotConfiguredError';
  }
}

const nativeAdapter: SecureSettingsAdapter = {
  async read() {
    const keychain = require('react-native-keychain') as NativeKeychain;
    const credentials = await keychain.getGenericPassword({service: SERVICE});
    return credentials === false ? null : credentials.password;
  },
  async write(value) {
    const keychain = require('react-native-keychain') as NativeKeychain;
    await keychain.setGenericPassword('deepseek', value, {service: SERVICE});
  },
};

function normalizeSettings(settings: DeepSeekSettings): DeepSeekSettings {
  const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';
  if (!apiKey) {
    throw new DeepSeekNotConfiguredError();
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(settings.apiBase);
  } catch {
    throw new DeepSeekSettingsValidationError('API base must be a valid HTTPS URL.');
  }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new DeepSeekSettingsValidationError('API base must be a valid HTTPS URL.');
  }

  const model = typeof settings.model === 'string' ? settings.model.trim() : '';
  if (!model) {
    throw new DeepSeekSettingsValidationError('Model is required.');
  }
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) {
    throw new DeepSeekSettingsValidationError('The temperature must be between 0 and 2.');
  }
  if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1_000 || settings.timeoutMs > 120_000) {
    throw new DeepSeekSettingsValidationError('The request timeout must be between 1000 and 120000 milliseconds.');
  }

  return {
    apiKey,
    apiBase: baseUrl.toString().replace(/\/$/, ''),
    model,
    temperature: settings.temperature,
    timeoutMs: settings.timeoutMs,
  };
}

export function createSecureSettings(adapter: SecureSettingsAdapter = nativeAdapter) {
  return {
    async getDeepSeekSettings(): Promise<DeepSeekSettings> {
      const stored = await adapter.read();
      if (!stored) {
        throw new DeepSeekNotConfiguredError();
      }

      let parsed: Partial<DeepSeekSettings>;
      try {
        parsed = JSON.parse(stored) as Partial<DeepSeekSettings>;
      } catch {
        throw new DeepSeekSettingsValidationError('Stored DeepSeek settings are invalid. Re-enter them in settings.');
      }

      return normalizeSettings({
        apiKey: parsed.apiKey ?? '',
        apiBase: parsed.apiBase ?? DEFAULT_DEEPSEEK_SETTINGS.apiBase,
        model: parsed.model ?? DEFAULT_DEEPSEEK_SETTINGS.model,
        temperature: parsed.temperature ?? DEFAULT_DEEPSEEK_SETTINGS.temperature,
        timeoutMs: parsed.timeoutMs ?? DEFAULT_DEEPSEEK_SETTINGS.timeoutMs,
      });
    },

    async setDeepSeekSettings(settings: DeepSeekSettings): Promise<void> {
      await adapter.write(JSON.stringify(normalizeSettings(settings)));
    },
  };
}

const defaultStore = createSecureSettings();

export const getDeepSeekSettings = defaultStore.getDeepSeekSettings;
export const setDeepSeekSettings = defaultStore.setDeepSeekSettings;
