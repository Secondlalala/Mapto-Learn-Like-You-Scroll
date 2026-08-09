import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import {BookOpen, FilePlus2} from 'lucide-react-native';
import type {Book, ConceptCard, OutlineNode} from '../../domain/models';
import {colors} from '../theme';

interface BookSummary {book: Book; cards: number; completed: number; total: number; hasResume: boolean}
interface Props {
  dependencies: {
    repositories: {
      listBooks(): Promise<Book[]>;
      listCards(bookId: string): Promise<ConceptCard[]>;
      listOutlineNodes(bookId: string): Promise<OutlineNode[]>;
      getLastReadCard(bookId: string): Promise<string | null>;
    };
    pickBookUri(): Promise<string>;
    importBook(uri: string): Promise<Book>;
  };
  onOpenBook(bookId: string): void;
}

export default function LibraryScreen({dependencies, onOpenBook}: Props) {
  const [items, setItems] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const books = await dependencies.repositories.listBooks();
      const summaries = await Promise.all(books.map(async book => {
        const [cards, nodes, lastRead] = await Promise.all([
          dependencies.repositories.listCards(book.id),
          dependencies.repositories.listOutlineNodes(book.id),
          dependencies.repositories.getLastReadCard(book.id),
        ]);
        return {book, cards: cards.length, completed: nodes.filter(node => node.status === 'completed').length, total: nodes.length, hasResume: Boolean(lastRead)};
      }));
      setItems(summaries);
    } catch {
      setError('书库加载失败');
    } finally {
      setLoading(false);
    }
  }, [dependencies.repositories]);

  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const importSelected = async () => {
    setImporting(true);
    setError(null);
    try {
      await dependencies.importBook(await dependencies.pickBookUri());
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error && /cancel/i.test(caught.message) ? null : '导入失败，请选择 Markdown 或 TXT 文件';
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}><View><Text style={styles.title}>我的书库</Text><Text style={styles.subtitle}>本地书籍与学习进度</Text></View></View>
      <Pressable disabled={importing} onPress={() => { importSelected().catch(() => undefined); }} style={styles.importButton}>
        {importing ? <ActivityIndicator color="#FFFFFF" /> : <FilePlus2 size={20} color="#FFFFFF" />}
        <Text style={styles.importText}>{importing ? '正在导入' : '导入 Markdown / TXT'}</Text>
      </Pressable>
      {error ? <View style={styles.errorBox}><Text style={styles.error}>{error}</Text><Pressable onPress={() => { refresh().catch(() => undefined); }}><Text style={styles.retry}>重试</Text></Pressable></View> : null}
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
        <FlatList
          data={items}
          keyExtractor={item => item.book.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { refresh().catch(() => undefined); }} />}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<View style={styles.center}><BookOpen size={34} color={colors.muted} /><Text style={styles.empty}>还没有导入书籍</Text></View>}
          renderItem={({item}) => (
            <View style={styles.row}>
              <View style={styles.rowTop}><BookOpen size={22} color={colors.accent} /><View style={styles.rowText}><Text style={styles.bookTitle}>{item.book.title}</Text><Text style={styles.meta}>{`${item.cards} 张卡片 · 已完成 ${item.completed}/${item.total} 节`}</Text></View></View>
              <Pressable style={styles.resume} onPress={() => onOpenBook(item.book.id)}><Text style={styles.resumeText}>{item.hasResume ? '继续阅读' : '开始阅读'}</Text></Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background, paddingHorizontal: 16},
  header: {paddingTop: 20, paddingBottom: 14}, title: {fontSize: 26, fontWeight: '700', color: colors.text}, subtitle: {fontSize: 13, color: colors.muted, marginTop: 3},
  importButton: {height: 48, backgroundColor: colors.ink, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 14},
  importText: {color: '#FFFFFF', fontWeight: '600', fontSize: 15},
  list: {paddingBottom: 20, gap: 10}, emptyList: {flexGrow: 1}, center: {flex: 1, minHeight: 160, alignItems: 'center', justifyContent: 'center'},
  empty: {color: colors.muted, marginTop: 10, fontSize: 15},
  row: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 15},
  rowTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 11}, rowText: {flex: 1}, bookTitle: {fontSize: 17, fontWeight: '600', color: colors.text}, meta: {fontSize: 13, color: colors.muted, marginTop: 5},
  resume: {alignSelf: 'flex-end', marginTop: 12, minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: colors.accentSoft}, resumeText: {color: colors.accent, fontWeight: '700'},
  errorBox: {padding: 12, backgroundColor: '#FEECEB', marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between'}, error: {color: colors.danger}, retry: {color: colors.danger, fontWeight: '700'},
});
