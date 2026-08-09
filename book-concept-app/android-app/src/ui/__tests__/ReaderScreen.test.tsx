import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {BackHandler} from 'react-native';
import ReaderScreen, {selectGenerationTarget} from '../screens/ReaderScreen';
import {book, cards, outline} from '../testFixtures';

const nextSection = {
  ...outline[1], id: 'section-3', title: '1.2 量子场', parentId: 'section-1',
  status: 'queued' as const, startOffset: 101, endOffset: 180,
};

function dependencies() {
  return {
    repositories: {
      getBook: jest.fn().mockResolvedValue(book),
      listCards: jest.fn().mockResolvedValue(cards),
      listOutlineNodes: jest.fn().mockResolvedValue([...outline, nextSection]),
      getLastReadCard: jest.fn().mockResolvedValue('card-3'),
      setLastReadCard: jest.fn().mockResolvedValue(undefined),
      toggleFavorite: jest.fn().mockResolvedValue(true),
      getGenerationState: jest.fn().mockResolvedValue(null),
      getCardScrollOffset: jest.fn().mockResolvedValue(0),
      setCardScrollOffset: jest.fn().mockResolvedValue(undefined),
    },
    generationCoordinator: {
      prefetch: jest.fn().mockResolvedValue(null),
      retry: jest.fn().mockResolvedValue(null),
    },
  };
}

function measure(view: ReturnType<typeof render>, height = 620) {
  fireEvent(view.getByTestId('reader-viewport'), 'layout', {nativeEvent: {layout: {height}}});
}

it('selects the earliest failed target before the first queued node after the active section', () => {
  const failed = {...outline[0], id: 'failed-early', status: 'failed' as const, startOffset: 5};
  expect(selectGenerationTarget([nextSection, failed], 'section-2')).toBe(failed);
  expect(selectGenerationTarget([...outline, nextSection], 'section-2')).toBe(nextSection);
});

it('optimistically marks the exact target node as generating before the request settles', async () => {
  const deps = dependencies();
  deps.generationCoordinator.prefetch.mockImplementation(() => new Promise(() => {}));
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} />);
  measure(view);

  await waitFor(() => expect(deps.generationCoordinator.prefetch).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText('打开大纲'));
  expect(screen.getByTestId(`generation-status-${nextSection.id}`).props.children).toBe('生成中');
  expect(screen.getByTestId('active-generation-target').props.children).toContain(nextSection.title);
});

it('resumes the last card and immediately prefetches after its active section', async () => {
  const deps = dependencies();
  deps.generationCoordinator.prefetch.mockImplementation(() => new Promise(() => {}));
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} />);
  measure(view);

  expect(await screen.findByTestId('card-card-3')).toBeTruthy();
  await waitFor(() => expect(deps.generationCoordinator.prefetch).toHaveBeenCalledWith(book.id, 'section-2'));
  expect(deps.generationCoordinator.prefetch).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('active-generation-target').props.children).toContain(nextSection.title);
});

it('prefetches the subsequent section only after the reader progresses', async () => {
  const generatedCard = {...cards[2], id: 'card-4', sectionId: 'section-3'};
  const subsequentSection = {...nextSection, id: 'section-4', title: '1.3 规范场', startOffset: 181, endOffset: 260};
  const deps = dependencies();
  deps.repositories.listCards.mockResolvedValue([ ...cards, generatedCard ]);
  deps.repositories.listOutlineNodes.mockResolvedValue([...outline, nextSection, subsequentSection]);
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} />);
  measure(view);
  await screen.findByTestId('reader-list');
  await waitFor(() => expect(deps.generationCoordinator.prefetch).toHaveBeenCalledWith(book.id, 'section-2'));

  act(() => {
    view.getByTestId('reader-list').props.onViewableItemsChanged({viewableItems: [{item: generatedCard, isViewable: true}]});
  });

  await waitFor(() => expect(deps.generationCoordinator.prefetch).toHaveBeenCalledWith(book.id, 'section-3'));
  expect(deps.generationCoordinator.prefetch).toHaveBeenCalledTimes(2);
});

it('refreshes outline on generation start and failure, then retries the failed node', async () => {
  const deps = dependencies();
  const failedNode = {...nextSection, status: 'failed' as const};
  deps.repositories.listOutlineNodes
    .mockResolvedValueOnce([...outline, nextSection])
    .mockResolvedValue([...outline, failedNode]);
  deps.repositories.getGenerationState.mockResolvedValue({
    sectionId: failedNode.id, status: 'failed', nextChunkIndex: 0,
    errorMessage: '请先在设置中保存 DeepSeek API Key', errorCode: 'deepseek_not_configured', updatedAt: 'now',
  });
  deps.generationCoordinator.prefetch.mockRejectedValue(new Error('missing key'));
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} />);
  measure(view);

  expect(await screen.findByText('1.2 量子场生成失败')).toBeTruthy();
  expect(screen.getByText('请先在设置中保存 DeepSeek API Key')).toBeTruthy();
  expect(deps.repositories.listOutlineNodes.mock.calls.length).toBeGreaterThanOrEqual(3);
  fireEvent.press(screen.getByText('重试生成'));
  await waitFor(() => expect(deps.generationCoordinator.retry).toHaveBeenCalledWith('section-3'));
});

it('retries automatic generation after settings are saved', async () => {
  const deps = dependencies();
  deps.generationCoordinator.prefetch.mockRejectedValueOnce(new Error('missing key')).mockResolvedValueOnce(null);
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} generationRevision={0} />);
  measure(view);
  await waitFor(() => expect(deps.generationCoordinator.prefetch).toHaveBeenCalledTimes(1));

  view.rerender(<ReaderScreen bookId={book.id} dependencies={deps} generationRevision={1} />);

  await waitFor(() => expect(deps.generationCoordinator.prefetch).toHaveBeenCalledTimes(2));
});

it('persists the visible card and uses measured viewport height for stable paging', async () => {
  const deps = dependencies();
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} />);
  measure(view, 577);
  const list = await screen.findByTestId('reader-list');
  expect(list.props.nestedScrollEnabled).toBe(true);
  expect(list.props.getItemLayout(cards, 2)).toEqual({length: 577, offset: 1154, index: 2});

  act(() => {
    list.props.onViewableItemsChanged({viewableItems: [{item: cards[1], isViewable: true}]});
  });
  await waitFor(() => expect(deps.repositories.setLastReadCard).toHaveBeenCalledWith(book.id, 'card-2'));
  expect(screen.getByTestId('card-card-3').props.style).toEqual(expect.arrayContaining([expect.objectContaining({height: 577})]));
});

it('opens the outline and jumps to the first card in a selected section', async () => {
  const deps = dependencies();
  const scrollToIndex = jest.fn();
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} listRef={{current: {scrollToIndex}}} />);
  measure(view);
  await screen.findByTestId('reader-list');
  fireEvent.press(screen.getByLabelText('打开大纲'));
  fireEvent.press(screen.getByText('1.1 经典场'));
  expect(scrollToIndex).toHaveBeenCalledWith({animated: true, index: 2});
});

it('closes the outline drawer on Android back before leaving the reader', async () => {
  const handlers: Array<() => boolean | null | undefined> = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {remove: jest.fn()};
  });
  const view = render(<ReaderScreen bookId={book.id} dependencies={dependencies()} />);
  measure(view);
  await screen.findByTestId('reader-list');
  fireEvent.press(screen.getByLabelText('打开大纲'));
  expect(screen.getByText('文章大纲')).toBeTruthy();

  expect(handlers.length).toBeGreaterThan(0);
  act(() => { handlers.at(-1)?.(); });

  expect(screen.queryByText('文章大纲')).toBeNull();
});

it('shows an error with retry when reader loading fails', async () => {
  const deps = dependencies();
  deps.repositories.listCards.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(cards);
  const view = render(<ReaderScreen bookId={book.id} dependencies={deps} />);
  expect(await screen.findByText('阅读内容加载失败')).toBeTruthy();
  fireEvent.press(screen.getByText('重试'));
  measure(view);
  expect(await screen.findByTestId('reader-list')).toBeTruthy();
});
