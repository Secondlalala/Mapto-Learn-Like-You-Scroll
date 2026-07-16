import {getDeepSeekSettings, type DeepSeekSettings} from '../settings/secureSettings';
import type {DeepSeekMessage} from './prompts';

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

interface FetchInit {
  method: 'POST';
  redirect: 'error';
  headers: Record<string, string>;
  body: string;
  signal: unknown;
}

interface AbortControllerLike {
  signal: {aborted?: boolean};
  abort(): void;
}

interface TimerAdapter {
  sleep(delayMs: number): Promise<void>;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DeepSeekClientDependencies {
  getSettings(): Promise<DeepSeekSettings>;
  fetch(url: string, init: FetchInit): Promise<ResponseLike>;
  timers: TimerAdapter;
  createAbortController(): AbortControllerLike;
}

export interface DeepSeekClient {
  complete(messages: DeepSeekMessage[]): Promise<string>;
}

export class DeepSeekApiError extends Error {
  readonly code = 'deepseek_api_error';

  constructor(readonly status: number, readonly retryable: boolean) {
    super(`DeepSeek request failed with HTTP status ${status}.`);
    this.name = 'DeepSeekApiError';
  }
}

export class DeepSeekRateLimitError extends Error {
  readonly code = 'deepseek_rate_limited';
  readonly retryable = true;

  constructor() {
    super('DeepSeek is rate limited. Try again shortly.');
    this.name = 'DeepSeekRateLimitError';
  }
}

export class DeepSeekNetworkError extends Error {
  readonly retryable = true;

  constructor(readonly code: 'deepseek_timeout' | 'deepseek_network_error') {
    super(code === 'deepseek_timeout' ? 'DeepSeek request timed out. Try again.' : 'Could not reach DeepSeek. Try again.');
    this.name = 'DeepSeekNetworkError';
  }
}

const defaultTimers: TimerAdapter = {
  sleep: delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const defaultDependencies: DeepSeekClientDependencies = {
  getSettings: getDeepSeekSettings,
  fetch: (url, init) => fetch(url, init as RequestInit) as unknown as Promise<ResponseLike>,
  timers: defaultTimers,
  createAbortController: () => new AbortController(),
};

const retryDelays = [1_000, 2_000, 4_000];
const transientStatuses = new Set([429, 500, 502, 503, 504]);

async function readCompletion(response: ResponseLike): Promise<string> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DeepSeekApiError(response.status, true);
  }
  const content = (payload as {choices?: Array<{message?: {content?: unknown}}>} | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new DeepSeekApiError(response.status, true);
  }
  return content;
}

type AttemptResult =
  | {kind: 'completed'; content: string}
  | {kind: 'http_error'; status: number};

async function performAttempt(
  dependencies: DeepSeekClientDependencies,
  settings: DeepSeekSettings,
  url: string,
  messages: DeepSeekMessage[],
): Promise<AttemptResult> {
  const controller = dependencies.createAbortController();
  let timeoutHandle: unknown;
  let timedOut = false;
  const operation = (async (): Promise<AttemptResult> => {
    const response = await dependencies.fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {kind: 'http_error', status: response.status};
    }
    return {kind: 'completed', content: await readCompletion(response)};
  })();
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = dependencies.timers.setTimeout(() => {
      timedOut = true;
      reject(new DeepSeekNetworkError('deepseek_timeout'));
      controller.abort();
    }, settings.timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error instanceof DeepSeekApiError || error instanceof DeepSeekNetworkError) {
      throw error;
    }
    const aborted = timedOut || controller.signal.aborted === true || (error as {name?: unknown})?.name === 'AbortError';
    throw new DeepSeekNetworkError(aborted ? 'deepseek_timeout' : 'deepseek_network_error');
  } finally {
    dependencies.timers.clearTimeout(timeoutHandle);
  }
}

export function createDeepSeekClient(
  overrides: Partial<DeepSeekClientDependencies> = {},
): DeepSeekClient {
  const dependencies = {...defaultDependencies, ...overrides};
  return {
    async complete(messages) {
      const settings = await dependencies.getSettings();
      const url = `${settings.apiBase.replace(/\/+$/, '')}/chat/completions`;

      for (let attempt = 0; ; attempt += 1) {
        const result = await performAttempt(dependencies, settings, url, messages);
        if (result.kind === 'completed') {
          return result.content;
        }

        const retryableStatus = transientStatuses.has(result.status);
        if (retryableStatus && attempt < retryDelays.length) {
          await dependencies.timers.sleep(retryDelays[attempt]);
          continue;
        }
        if (result.status === 429) {
          throw new DeepSeekRateLimitError();
        }
        throw new DeepSeekApiError(result.status, retryableStatus);
      }
    },
  };
}

const defaultClient = createDeepSeekClient();

export const completeDeepSeekChat = defaultClient.complete;
