import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {Heart, HeartOff} from 'lucide-react-native';
import type {ConceptCard} from '../../domain/models';
import {colors} from '../theme';

interface Props {
  repositories: {
    listFavoriteCards(): Promise<ConceptCard[]>;
    toggleFavorite(cardId: string): Promise<boolean>;
  };
  onOpenCard(card: ConceptCard): void;
}

export default function FavoritesScreen({repositories, onOpenCard}: Props) {
  const [cards, setCards] = useState<ConceptCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try { setCards(await repositories.listFavoriteCards()); } catch { setError(true); } finally { setLoading(false); }
  }, [repositories]);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  if (loading) {return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;}
  if (error) {return <View style={styles.center}><Text style={styles.error}>收藏加载失败</Text><Pressable style={styles.retry} onPress={() => { load().catch(() => undefined); }}><Text>重试</Text></Pressable></View>;}
  return (
    <View style={styles.container}>
      <Text style={styles.title}>我的收藏</Text>
      <FlatList
        data={cards}
        keyExtractor={item => item.id}
        contentContainerStyle={cards.length ? styles.list : styles.emptyList}
        ListEmptyComponent={<View style={styles.center}><Heart size={34} color={colors.muted} /><Text style={styles.empty}>还没有收藏卡片</Text></View>}
        renderItem={({item}) => (
          <Pressable style={styles.card} onPress={() => onOpenCard(item)}>
            <View style={styles.cardText}><Text style={styles.chapter}>{item.chapter}</Text><Text style={styles.cardTitle}>{item.title}</Text><Text numberOfLines={2} style={styles.summary}>{item.oneSentence}</Text></View>
            <Pressable
              accessibilityLabel={`取消收藏 ${item.title}`}
              style={styles.icon}
              onPress={async () => { await repositories.toggleFavorite(item.id); await load(); }}>
              <HeartOff size={21} color={colors.danger} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background, paddingHorizontal: 16}, title: {fontSize: 26, fontWeight: '700', color: colors.text, paddingTop: 20, paddingBottom: 14},
  list: {gap: 10, paddingBottom: 20}, emptyList: {flexGrow: 1}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 180}, empty: {color: colors.muted, marginTop: 10},
  card: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 15, flexDirection: 'row'}, cardText: {flex: 1}, chapter: {fontSize: 12, color: colors.accent}, cardTitle: {fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 4}, summary: {fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 6}, icon: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  error: {color: colors.danger, marginBottom: 12}, retry: {padding: 12, backgroundColor: colors.accentSoft},
});
