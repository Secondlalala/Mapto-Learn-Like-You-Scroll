type GenerateNext = (bookId: string, afterSectionId?: string) => Promise<unknown>;
type GenerateSection = (sectionId: string) => Promise<unknown>;

export function createGenerationCoordinator(
  generateNextSection: GenerateNext,
  generateSection: GenerateSection,
) {
  const inFlight = new Map<string, Promise<unknown>>();
  const bookRuns = new Map<string, {
    activeSectionId?: string;
    queued: {activeSectionId?: string} | null;
    promise: Promise<unknown>;
  }>();

  function run(key: string, action: () => Promise<unknown>): Promise<unknown> {
    const existing = inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = action().finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, promise);
    return promise;
  }

  return {
    prefetch(bookId: string, activeSectionId?: string): Promise<unknown> {
      const existing = bookRuns.get(bookId);
      if (existing) {
        if (existing.activeSectionId !== activeSectionId) {
          existing.queued = {activeSectionId};
        }
        return existing.promise;
      }

      const state = {
        activeSectionId,
        queued: null as {activeSectionId?: string} | null,
        promise: Promise.resolve() as Promise<unknown>,
      };
      bookRuns.set(bookId, state);
      state.promise = (async () => {
        let result: unknown;
        while (true) {
          result = await generateNextSection(bookId, state.activeSectionId);
          const queued = state.queued;
          if (!queued) {
            return result;
          }
          state.queued = null;
          state.activeSectionId = queued.activeSectionId;
        }
      })().finally(() => {
        if (bookRuns.get(bookId) === state) {
          bookRuns.delete(bookId);
        }
      });
      return state.promise;
    },
    retry(sectionId: string): Promise<unknown> {
      return run(`section:${sectionId}`, () => generateSection(sectionId));
    },
  };
}

export type GenerationCoordinator = ReturnType<typeof createGenerationCoordinator>;
