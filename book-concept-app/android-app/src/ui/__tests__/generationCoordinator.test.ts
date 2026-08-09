import {createGenerationCoordinator} from '../generationCoordinator';

it('deduplicates concurrent prefetch across reader remounts', async () => {
  let finish!: (value: unknown) => void;
  const generateNextSection = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const coordinator = createGenerationCoordinator(generateNextSection, jest.fn());

  const first = coordinator.prefetch('book-1', 'section-1');
  const remounted = coordinator.prefetch('book-1', 'section-1');

  expect(generateNextSection).toHaveBeenCalledTimes(1);
  expect(remounted).toBe(first);
  finish({sectionId: 'section-2'});
  await first;
});

it('allows the subsequent section after the reader progresses', async () => {
  const generateNextSection = jest.fn().mockResolvedValue({sectionId: 'generated'});
  const coordinator = createGenerationCoordinator(generateNextSection, jest.fn());

  await coordinator.prefetch('book-1', 'section-1');
  await coordinator.prefetch('book-1', 'section-2');

  expect(generateNextSection).toHaveBeenNthCalledWith(1, 'book-1', 'section-1');
  expect(generateNextSection).toHaveBeenNthCalledWith(2, 'book-1', 'section-2');
});

it('coalesces rapid active section changes and resolves callers after the latest follow-up', async () => {
  const finishes: Array<(value: unknown) => void> = [];
  const generateNextSection = jest.fn(() => new Promise(resolve => { finishes.push(resolve); }));
  const coordinator = createGenerationCoordinator(generateNextSection, jest.fn());

  const first = coordinator.prefetch('book-1', 'section-1');
  const skipped = coordinator.prefetch('book-1', 'section-2');
  const latest = coordinator.prefetch('book-1', 'section-3');
  let settled = false;
  latest.finally(() => { settled = true; });

  expect(first).toBe(skipped);
  expect(skipped).toBe(latest);
  expect(generateNextSection).toHaveBeenCalledTimes(1);
  finishes[0]({sectionId: 'section-2'});
  await Promise.resolve();
  await Promise.resolve();

  expect(settled).toBe(false);
  expect(generateNextSection).toHaveBeenCalledTimes(2);
  expect(generateNextSection).toHaveBeenNthCalledWith(1, 'book-1', 'section-1');
  expect(generateNextSection).toHaveBeenNthCalledWith(2, 'book-1', 'section-3');

  finishes[1]({sectionId: 'section-4'});
  await Promise.all([first, skipped, latest]);
  expect(generateNextSection).toHaveBeenCalledTimes(2);
});

it('deduplicates explicit retries for the same failed node', async () => {
  const generateSection = jest.fn().mockResolvedValue({sectionId: 'failed-1'});
  const coordinator = createGenerationCoordinator(jest.fn(), generateSection);

  await Promise.all([
    coordinator.retry('failed-1'),
    coordinator.retry('failed-1'),
  ]);

  expect(generateSection).toHaveBeenCalledTimes(1);
});
