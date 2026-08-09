import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {ListTree} from 'lucide-react-native';
import type {Book, ConceptCard as Card, GenerationState, OutlineNode} from '../../domain/models';
import type {GenerationCoordinator} from '../generationCoordinator';
import ConceptCard from '../components/ConceptCard';
import OutlineDrawer from '../components/OutlineDrawer';
import {colors} from '../theme';

export interface ReaderDependencies {
  repositories: {
    getBook(id: string): Promise<Book | null>;
    listCards(bookId: string): Promise<Card[]>;
    listOutlineNodes(bookId: string): Promise<OutlineNode[]>;
    getLastReadCard(bookId: string): Promise<string | null>;
    setLastReadCard(bookId: string, cardId: string): Promise<void>;
    toggleFavorite(cardId: string): Promise<boolean>;
    getGenerationState(sectionId: string): Promise<GenerationState | null>;
    getCardScrollOffset(cardId: string): Promise<number>;
    setCardScrollOffset(cardId: string, offset: number): Promise<void>;
  };
  generationCoordinator: GenerationCoordinator;
}

interface Props {
  bookId: string | null;
  initialCardId?: string | null;
  generationRevision?: number;
  dependencies: ReaderDependencies;
  listRef?: {current: {scrollToIndex(options: {animated: boolean; index: number}): void} | null};
}

interface GenerationFailure {node: OutlineNode; state: GenerationState | null}

export function selectGenerationTarget(nodes: OutlineNode[], activeSectionId: string | null): OutlineNode | null {
  const ordered = [...nodes].sort((left, right) => left.startOffset - right.startOffset || left.id.localeCompare(right.id));
  const failed = ordered.find(node => node.status === 'failed');
  if (failed) {
    return failed;
  }
  const activeIndex = activeSectionId ? ordered.findIndex(node => node.id === activeSectionId) : -1;
  return ordered.slice(activeIndex + 1).find(node => node.status === 'queued') ?? null;
}

function markTargetGenerating(nodes: OutlineNode[], target: OutlineNode): OutlineNode[] {
  return nodes.map(node => node.id === target.id ? {...node, status: 'generating'} : node);
}

export default function ReaderScreen({bookId, initialCardId, generationRevision = 0, dependencies, listRef}: Props) {
  const internalRef = useRef<FlatList<Card>>(null);
  const effectiveRef = listRef ?? internalRef;
  const lastAttempt = useRef<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [scrollOffsets, setScrollOffsets] = useState<Record<string, number>>({});
  const [resumeIndex, setResumeIndex] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [loading, setLoading] = useState(Boolean(bookId));
  const [error, setError] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationTarget, setGenerationTarget] = useState<OutlineNode | null>(null);
  const [generationFailure, setGenerationFailure] = useState<GenerationFailure | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  const readOffsets = useCallback(async (nextCards: Card[]) => {
    const entries = await Promise.all(nextCards.map(async card => [card.id, await dependencies.repositories.getCardScrollOffset(card.id)] as const));
    return Object.fromEntries(entries);
  }, [dependencies.repositories]);

  const findFailure = useCallback(async (nodes: OutlineNode[]) => {
    const failed = [...nodes]
      .filter(node => node.status === 'failed')
      .sort((left, right) => left.startOffset - right.startOffset || left.id.localeCompare(right.id))[0];
    if (!failed) {
      setGenerationFailure(null);
      return;
    }
    setGenerationFailure({node: failed, state: await dependencies.repositories.getGenerationState(failed.id)});
  }, [dependencies.repositories]);

  const refreshOutline = useCallback(async () => {
    if (!bookId) {return [];}
    const nodes = await dependencies.repositories.listOutlineNodes(bookId);
    setOutline(nodes);
    await findFailure(nodes);
    return nodes;
  }, [bookId, dependencies.repositories, findFailure]);

  const refreshCardsAndOutline = useCallback(async () => {
    if (!bookId) {return;}
    const [nextCards, nextOutline] = await Promise.all([
      dependencies.repositories.listCards(bookId),
      dependencies.repositories.listOutlineNodes(bookId),
    ]);
    setCards(nextCards);
    setOutline(nextOutline);
    setScrollOffsets(await readOffsets(nextCards));
    await findFailure(nextOutline);
    if (!activeSectionId && nextCards[0]) {
      setActiveSectionId(nextCards[0].sectionId);
    }
  }, [activeSectionId, bookId, dependencies.repositories, findFailure, readOffsets]);

  const load = useCallback(async () => {
    if (!bookId) {return;}
    setLoading(true);
    setError(false);
    try {
      const [nextBook, nextCards, nextOutline, savedCard] = await Promise.all([
        dependencies.repositories.getBook(bookId),
        dependencies.repositories.listCards(bookId),
        dependencies.repositories.listOutlineNodes(bookId),
        dependencies.repositories.getLastReadCard(bookId),
      ]);
      const requestedCard = initialCardId ?? savedCard;
      const index = Math.max(0, nextCards.findIndex(card => card.id === requestedCard));
      setBook(nextBook);
      setCards(nextCards);
      setOutline(nextOutline);
      setScrollOffsets(await readOffsets(nextCards));
      setResumeIndex(index);
      setActiveSectionId(nextCards[index]?.sectionId ?? null);
      await findFailure(nextOutline);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [bookId, dependencies.repositories, findFailure, initialCardId, readOffsets]);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  useEffect(() => {
    if (!drawerOpen) {return undefined;}
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setDrawerOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [drawerOpen]);

  useEffect(() => {
    if (!bookId || loading || error) {return;}
    const attemptKey = `${bookId}:${activeSectionId ?? 'start'}:${generationRevision}`;
    if (lastAttempt.current === attemptKey) {return;}
    lastAttempt.current = attemptKey;
    let active = true;
    const immediateTarget = selectGenerationTarget(outlineRef.current, activeSectionId);
    setGenerating(Boolean(immediateTarget));
    setGenerationTarget(immediateTarget);
    if (immediateTarget) {
      setOutline(current => markTargetGenerating(current, immediateTarget));
    }
    setGenerationFailure(null);
    const run = async () => {
      const freshOutline = await dependencies.repositories.listOutlineNodes(bookId);
      const target = selectGenerationTarget(freshOutline, activeSectionId);
      if (!active) {return;}
      if (!target) {
        setOutline(freshOutline);
        setGenerating(false);
        setGenerationTarget(null);
        return;
      }
      setOutline(markTargetGenerating(freshOutline, target));
      setGenerationTarget(target);
      setGenerating(true);
      try {
        await dependencies.generationCoordinator.prefetch(bookId, activeSectionId ?? undefined);
        if (active) {await refreshCardsAndOutline();}
      } catch {
        if (active) {await refreshOutline();}
      } finally {
        if (active) {
          setGenerating(false);
          setGenerationTarget(null);
        }
      }
    };
    run().catch(() => active && setGenerating(false));
    return () => { active = false; };
  }, [activeSectionId, bookId, dependencies.generationCoordinator, dependencies.repositories, error, generationRevision, loading, refreshCardsAndOutline, refreshOutline]);

  const retryFailed = async () => {
    if (!generationFailure) {return;}
    const failedNode = generationFailure.node;
    setGenerating(true);
    setGenerationTarget(failedNode);
    setOutline(current => markTargetGenerating(current, failedNode));
    setGenerationFailure(null);
    try {
      await dependencies.generationCoordinator.retry(failedNode.id);
      await refreshCardsAndOutline();
    } catch {
      await refreshOutline();
    } finally {
      setGenerating(false);
      setGenerationTarget(null);
    }
  };

  const onViewableItemsChanged = useCallback(({viewableItems}: {viewableItems: Array<{item: Card; isViewable?: boolean}>}) => {
    const visible = viewableItems.find(item => item.isViewable !== false)?.item;
    if (!visible || !bookId) {return;}
    setActiveSectionId(visible.sectionId);
    dependencies.repositories.setLastReadCard(bookId, visible.id).catch(() => undefined);
  }, [bookId, dependencies.repositories]);

  const toggleFavorite = useCallback(async (card: Card) => {
    const isFavorite = await dependencies.repositories.toggleFavorite(card.id);
    setCards(current => current.map(item => item.id === card.id ? {...item, isFavorite} : item));
  }, [dependencies.repositories]);

  if (!bookId) {return <View style={styles.center}><Text style={styles.empty}>请先从书库选择一本书</Text></View>;}

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable accessibilityLabel="打开大纲" onPress={() => setDrawerOpen(true)} style={styles.toolButton}><ListTree size={22} color={colors.text} /></Pressable>
        <Text numberOfLines={1} style={styles.bookTitle}>{book?.title ?? '阅读'}</Text>
        <Text style={styles.counter}>{cards.length} 卡</Text>
      </View>
      <View testID="reader-viewport" style={styles.viewport} onLayout={event => setPageHeight(Math.round(event.nativeEvent.layout.height))}>
        {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.hint}>正在加载阅读内容</Text></View> : null}
        {!loading && error ? <View style={styles.center}><Text style={styles.error}>阅读内容加载失败</Text><Pressable style={styles.primary} onPress={() => { load().catch(() => undefined); }}><Text style={styles.primaryText}>重试</Text></Pressable></View> : null}
        {!loading && !error && cards.length && pageHeight > 0 ? (
          <FlatList
            testID="reader-list"
            ref={listRef ? undefined : internalRef}
            data={cards}
            keyExtractor={item => item.id}
            renderItem={({item}) => (
              <ConceptCard
                card={item}
                height={pageHeight}
                initialScrollOffset={scrollOffsets[item.id] ?? 0}
                onScrollOffset={(card, offset) => {
                  setScrollOffsets(current => ({...current, [card.id]: offset}));
                  dependencies.repositories.setCardScrollOffset(card.id, offset).catch(() => undefined);
                }}
                onToggleFavorite={toggleFavorite}
              />
            )}
            pagingEnabled
            nestedScrollEnabled
            initialScrollIndex={resumeIndex}
            getItemLayout={(_, index) => ({length: pageHeight, offset: pageHeight * index, index})}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={{itemVisiblePercentThreshold: 60}}
            showsVerticalScrollIndicator={false}
          />
        ) : null}
        {!loading && !error && !cards.length ? <View style={styles.center}><Text style={styles.empty}>{generating ? '正在生成第一批卡片' : '这本书还没有卡片'}</Text></View> : null}
        {generating && generationTarget ? <View style={styles.generationOverlay}><Text testID="active-generation-target" style={styles.generating}>{generationTarget.title} · 正在生成</Text></View> : null}
        {generationFailure ? (
          <View style={styles.failureOverlay}>
            <Text style={styles.failureTitle}>{generationFailure.node.title}生成失败</Text>
            <Text style={styles.failureMessage}>{generationFailure.state?.errorMessage ?? '生成失败，请重试'}</Text>
            <Pressable style={styles.retryGeneration} onPress={() => { retryFailed().catch(() => undefined); }}><Text style={styles.retryGenerationText}>重试生成</Text></Pressable>
          </View>
        ) : null}
      </View>
      {drawerOpen ? (
        <View style={styles.drawerLayer}>
          <Pressable style={styles.scrim} onPress={() => setDrawerOpen(false)} />
          <OutlineDrawer nodes={outline} activeSectionId={activeSectionId} generating={generating} onClose={() => setDrawerOpen(false)} onSelect={node => {
            const index = cards.findIndex(card => card.sectionId === node.id);
            if (index >= 0) {effectiveRef.current?.scrollToIndex({animated: true, index});}
            setDrawerOpen(false);
          }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  toolbar: {height: 52, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface},
  toolButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}, bookTitle: {flex: 1, fontSize: 16, fontWeight: '600', color: colors.text}, counter: {fontSize: 12, color: colors.muted, marginHorizontal: 10},
  viewport: {flex: 1, overflow: 'hidden'}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background},
  hint: {marginTop: 10, color: colors.muted}, empty: {fontSize: 16, color: colors.muted, textAlign: 'center'}, error: {fontSize: 16, color: colors.danger, marginBottom: 16},
  primary: {minHeight: 44, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink}, primaryText: {color: '#FFFFFF', fontWeight: '600'},
  generationOverlay: {position: 'absolute', top: 8, left: 16, right: 16, alignItems: 'center'}, generating: {paddingHorizontal: 14, paddingVertical: 7, color: colors.accent, backgroundColor: colors.accentSoft, fontSize: 12, fontWeight: '600'},
  failureOverlay: {position: 'absolute', top: 8, left: 12, right: 12, backgroundColor: '#FEECEB', borderWidth: 1, borderColor: '#F7B8B3', padding: 12},
  failureTitle: {fontSize: 14, fontWeight: '700', color: colors.danger}, failureMessage: {fontSize: 13, color: colors.text, marginTop: 4},
  retryGeneration: {alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginTop: 8, paddingHorizontal: 12, backgroundColor: colors.danger}, retryGenerationText: {color: '#FFFFFF', fontWeight: '700'},
  drawerLayer: {...StyleSheet.absoluteFillObject, zIndex: 20, flexDirection: 'row'}, scrim: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)'},
});
