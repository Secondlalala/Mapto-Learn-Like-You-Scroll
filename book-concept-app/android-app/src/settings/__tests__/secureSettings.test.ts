type DeepSeekSettings = {
  apiKey: string;
  apiBase: string;
  model: string;
  temperature: number;
  timeoutMs: number;
};

type SecureSettingsModule = {
  createSecureSettings: (adapter: {
    read: () => Promise<string | null>;
    write: (value: string) => Promise<void>;
  }) => {
    getDeepSeekSettings: () => Promise<DeepSeekSettings>;
    setDeepSeekSettings: (settings: DeepSeekSettings) => Promise<void>;
  };
};

function loadSecureSettings(): SecureSettingsModule {
  return require('../secureSettings') as SecureSettingsModule;
}

describe('secure DeepSeek settings', () => {
  it('persists validated settings only through the injected secure adapter', async () => {
    let secureSettings: SecureSettingsModule | undefined;
    expect(() => {
      secureSettings = loadSecureSettings();
    }).not.toThrow();

    const adapter = {read: jest.fn(), write: jest.fn<Promise<void>, [string]>(async () => undefined)};
    const settings: DeepSeekSettings = {
      apiKey: 'test-secret-value',
      apiBase: 'https://api.deepseek.com/',
      model: 'deepseek-chat',
      temperature: 0.4,
      timeoutMs: 30_000,
    };
    const store = secureSettings!.createSecureSettings(adapter);

    await store.setDeepSeekSettings(settings);

    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(adapter.write.mock.calls[0][0])).toEqual({
      ...settings,
      apiBase: 'https://api.deepseek.com',
    });
  });

  it.each([
    [{apiBase: 'http://api.deepseek.com'}, 'HTTPS'],
    [{temperature: -0.1}, 'temperature'],
    [{temperature: 2.1}, 'temperature'],
    [{timeoutMs: 999}, 'timeout'],
    [{timeoutMs: 120_001}, 'timeout'],
  ])('rejects invalid settings without persisting or exposing the key: %o', async (override, expectedMessage) => {
    const adapter = {read: jest.fn(), write: jest.fn(async () => undefined)};
    const store = loadSecureSettings().createSecureSettings(adapter);
    const settings = {
      apiKey: 'must-never-appear-in-errors',
      apiBase: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 0.3,
      timeoutMs: 30_000,
      ...override,
    };

    let error: unknown;
    try {
      await store.setDeepSeekSettings(settings);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(expectedMessage);
    expect((error as Error).message).not.toContain(settings.apiKey);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('returns a typed actionable error when the secure key is missing or blank', async () => {
    const adapter = {read: jest.fn(async () => JSON.stringify({apiKey: '   '})), write: jest.fn()};
    const store = loadSecureSettings().createSecureSettings(adapter);

    await expect(store.getDeepSeekSettings()).rejects.toMatchObject({
      name: 'DeepSeekNotConfiguredError',
      code: 'deepseek_not_configured',
      message: expect.stringContaining('API key'),
    });
  });
});
