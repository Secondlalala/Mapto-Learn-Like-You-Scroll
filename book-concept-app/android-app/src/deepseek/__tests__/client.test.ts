import {DeepSeekNotConfiguredError, type DeepSeekSettings} from '../../settings/secureSettings';

type ResponseLike = {ok: boolean; status: number; json: () => Promise<unknown>};
type ClientModule = {
  createDeepSeekClient: (dependencies: Record<string, unknown>) => {
    complete: (messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>) => Promise<string>;
  };
};

function loadClient(): ClientModule {
  return require('../client') as ClientModule;
}

const settings: DeepSeekSettings = {
  apiKey: 'fake-key-never-sent-to-network',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.3,
  timeoutMs: 30_000,
};

function response(status: number, body: unknown = {}): ResponseLike {
  return {ok: status >= 200 && status < 300, status, json: jest.fn(async () => body)};
}

function dependencies(fetchImpl: jest.Mock) {
  const sleep = jest.fn(async () => undefined);
  return {
    getSettings: jest.fn(async () => settings),
    fetch: fetchImpl,
    timers: {
      sleep,
      setTimeout: jest.fn<number, [() => void, number]>(() => 1),
      clearTimeout: jest.fn(),
    },
    createAbortController: () => ({signal: {aborted: false}, abort: jest.fn()}),
    sleep,
  };
}

describe('DeepSeek transport client', () => {
  it('posts configured chat completions without logging secrets or source', async () => {
    let clientModule: ClientModule | undefined;
    expect(() => {
      clientModule = loadClient();
    }).not.toThrow();

    const fetchImpl = jest.fn(async () => response(200, {choices: [{message: {content: '[{"ok":true}]'}}]}));
    const deps = dependencies(fetchImpl);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const messages = [{role: 'user' as const, content: 'BOUNDED_SOURCE'}];

    await expect(clientModule!.createDeepSeekClient(deps).complete(messages)).resolves.toBe('[{"ok":true}]');

    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}`},
      body: JSON.stringify({model: settings.model, temperature: settings.temperature, messages}),
    }));
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  it('uses only the 1, 2, and 4 second retry delays for 429 and transient 5xx', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, {choices: [{message: {content: 'done'}}]}));
    const deps = dependencies(fetchImpl);

    await expect(loadClient().createDeepSeekClient(deps).complete([])).resolves.toBe('done');

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(deps.sleep.mock.calls.flat()).toEqual([1_000, 2_000, 4_000]);
  });

  it('does not retry non-retryable 4xx responses or expose response content', async () => {
    const fetchImpl = jest.fn(async () => response(400, {error: {message: 'FULL_PRIVATE_SOURCE'}}));
    const deps = dependencies(fetchImpl);

    let error: unknown;
    try {
      await loadClient().createDeepSeekClient(deps).complete([]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({name: 'DeepSeekApiError', code: 'deepseek_api_error', retryable: false});
    expect((error as Error).message).not.toContain('FULL_PRIVATE_SOURCE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('returns a typed rate-limit error after exhausting retry delays', async () => {
    const fetchImpl = jest.fn(async () => response(429));
    const deps = dependencies(fetchImpl);

    await expect(loadClient().createDeepSeekClient(deps).complete([])).rejects.toMatchObject({
      name: 'DeepSeekRateLimitError',
      code: 'deepseek_rate_limited',
      retryable: true,
    });
    expect(deps.sleep.mock.calls.flat()).toEqual([1_000, 2_000, 4_000]);
  });

  it.each([501, 505])('does not retry non-transient HTTP %s responses', async status => {
    const fetchImpl = jest.fn(async () => response(status));
    const deps = dependencies(fetchImpl);

    await expect(loadClient().createDeepSeekClient(deps).complete([])).rejects.toMatchObject({
      name: 'DeepSeekApiError',
      status,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503, 504])('retries explicit transient HTTP %s responses', async status => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response(200, {choices: [{message: {content: 'done'}}]}));
    const deps = dependencies(fetchImpl);

    await expect(loadClient().createDeepSeekClient(deps).complete([])).resolves.toBe('done');
    expect(deps.sleep.mock.calls.flat()).toEqual([1_000]);
  });

  it('aborts on the configured timeout and returns a typed retryable network error', async () => {
    const signal = {aborted: false};
    const abort = jest.fn(() => {
      signal.aborted = true;
    });
    const fetchImpl = jest.fn(async () => {
      if (signal.aborted) {
        throw Object.assign(new Error('aborted'), {name: 'AbortError'});
      }
      return response(200);
    });
    const deps = dependencies(fetchImpl);
    deps.createAbortController = () => ({signal, abort});
    deps.timers.setTimeout = jest.fn<number, [() => void, number]>((callback, _delayMs) => {
      callback();
      return 1;
    });

    await expect(loadClient().createDeepSeekClient(deps).complete([])).rejects.toMatchObject({
      name: 'DeepSeekNetworkError',
      code: 'deepseek_timeout',
      retryable: true,
    });
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('keeps the timeout active through response JSON parsing and validation', async () => {
    let timeoutCallback: (() => void) | undefined;
    let rejectBody: ((error: Error) => void) | undefined;
    const body = new Promise<unknown>((_resolve, reject) => {
      rejectBody = reject;
    });
    const signal = {aborted: false};
    const abort = jest.fn(() => {
      signal.aborted = true;
      rejectBody?.(Object.assign(new Error('body aborted'), {name: 'AbortError'}));
    });
    const fetchImpl = jest.fn(async () => ({ok: true, status: 200, json: () => body}));
    const deps = dependencies(fetchImpl);
    deps.createAbortController = () => ({signal, abort});
    deps.timers.setTimeout = jest.fn<number, [() => void, number]>((callback, _delayMs) => {
      timeoutCallback = callback;
      return 1;
    });

    const completion = loadClient().createDeepSeekClient(deps).complete([]);
    await Promise.resolve();
    timeoutCallback?.();

    await expect(completion).rejects.toMatchObject({
      name: 'DeepSeekNetworkError',
      code: 'deepseek_timeout',
      retryable: true,
    });
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('propagates the typed missing-key error before fetch', async () => {
    const fetchImpl = jest.fn();
    const deps = dependencies(fetchImpl);
    deps.getSettings = jest.fn(async () => {
      throw new DeepSeekNotConfiguredError();
    });

    await expect(loadClient().createDeepSeekClient(deps).complete([])).rejects.toBeInstanceOf(DeepSeekNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
