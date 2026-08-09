import React, {useEffect, useRef} from 'react';
import {ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Heart, Volume2} from 'lucide-react-native';
import type {ConceptCard as Card} from '../../domain/models';
import {colors} from '../theme';

interface Props {
  card: Card;
  height: number;
  initialScrollOffset?: number;
  onScrollOffset?(card: Card, offset: number): void;
  onToggleFavorite(card: Card): void;
  onSpeak?(target: string, text: string): void;
  preparingSpeech?: string | null;
}

function Section({label, action, children}: {label: string; action?: React.ReactNode; children: React.ReactNode}) {
  return <View style={styles.section}><View style={styles.sectionHeading}><Text style={styles.label}>{label}</Text>{action}</View>{children}</View>;
}

function ListText({items}: {items: string[]}) {
  return <Text selectable style={styles.body}>{items.length ? items.join(' · ') : '暂无'}</Text>;
}

export default function ConceptCard({card, height, initialScrollOffset = 0, onScrollOffset, onToggleFavorite, onSpeak, preparingSpeech}: Props) {
  const latestOffset = useRef(initialScrollOffset);
  const persistedOffset = useRef(initialScrollOffset);
  const offsetCallback = useRef(onScrollOffset);
  offsetCallback.current = onScrollOffset;

  useEffect(() => {
    latestOffset.current = initialScrollOffset;
    persistedOffset.current = initialScrollOffset;
    return () => {
      if (latestOffset.current !== persistedOffset.current) {
        offsetCallback.current?.(card, latestOffset.current);
        persistedOffset.current = latestOffset.current;
      }
    };
    // The cleanup flushes the previous card before resetting refs for the next card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const readOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, Math.round(event.nativeEvent.contentOffset.y));
    latestOffset.current = offset;
    return offset;
  };

  const persistOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = readOffset(event);
    if (offset !== persistedOffset.current) {
      onScrollOffset?.(card, offset);
      persistedOffset.current = offset;
    }
  };

  const cardTarget = `card:${card.id}`;
  const fableTarget = `fable:${card.id}`;
  const speechButton = (target: string, label: string, text: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${card.title}`}
      disabled={!onSpeak || preparingSpeech === target}
      onPress={() => onSpeak?.(target, text)}
      style={styles.iconButton}>
      {preparingSpeech === target
        ? <ActivityIndicator size="small" color={colors.accent} />
        : <Volume2 size={21} color={colors.accent} />}
    </Pressable>
  );

  return (
    <View testID={`card-${card.id}`} style={[styles.frame, {height}]}>
      <ScrollView
        testID={`card-scroll-${card.id}`}
        nestedScrollEnabled
        contentOffset={{x: 0, y: initialScrollOffset}}
        contentContainerStyle={styles.content}
        onScroll={readOffset}
        onScrollEndDrag={persistOffset}
        onMomentumScrollEnd={persistOffset}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}>
        <View style={styles.headingRow}>
          <View style={styles.headingText}>
            <Text style={styles.chapter}>{card.chapter}</Text>
            <Text style={styles.title}>{card.title}</Text>
          </View>
          {speechButton(cardTarget, '朗读卡片', `${card.title}。${card.oneSentence}。${card.simpleExplanation}`)}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${card.isFavorite ? '取消收藏' : '收藏'} ${card.title}`}
            onPress={() => onToggleFavorite(card)}
            style={styles.iconButton}>
            <Heart size={22} color={card.isFavorite ? colors.danger : colors.muted} fill={card.isFavorite ? colors.danger : 'none'} />
          </Pressable>
        </View>
        <Section label="一句话理解"><Text selectable style={styles.lead}>{card.oneSentence}</Text></Section>
        <Section label="通俗解释"><Text selectable style={styles.body}>{card.simpleExplanation}</Text></Section>
        <Section label="寓言故事" action={speechButton(fableTarget, '朗读寓言', card.fable)}><Text selectable style={styles.body}>{card.fable}</Text></Section>
        <Section label="核心公式">
          <Text selectable style={styles.formula}>{card.formula || '本卡片没有核心公式'}</Text>
          {card.formulaExplanation ? <Text selectable style={styles.body}>{card.formulaExplanation}</Text> : null}
        </Section>
        <Section label="前置知识"><ListText items={card.prerequisites} /></Section>
        <Section label="关联概念"><ListText items={card.relatedConcepts} /></Section>
        <Section label="推荐追问">
          {card.questions.map(question => <Text selectable key={question} style={styles.question}>• {question}</Text>)}
        </Section>
        <Section label="原文片段"><Text selectable style={styles.source}>{card.sourceText}</Text></Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {width: '100%', backgroundColor: colors.background},
  content: {paddingHorizontal: 20, paddingTop: 18, paddingBottom: 72},
  headingRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 12}, headingText: {flex: 1},
  chapter: {fontSize: 13, color: colors.accent, marginBottom: 6}, title: {fontSize: 25, fontWeight: '700', color: colors.text, lineHeight: 32},
  iconButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  section: {paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border}, sectionHeading: {minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, label: {fontSize: 13, fontWeight: '700', color: colors.muted, marginBottom: 7},
  lead: {fontSize: 18, lineHeight: 28, color: colors.text, fontWeight: '500'}, body: {fontSize: 16, lineHeight: 26, color: colors.text},
  formula: {fontSize: 17, lineHeight: 27, color: colors.ink, backgroundColor: '#EFEFEB', padding: 12, marginBottom: 8},
  question: {fontSize: 15, lineHeight: 25, color: colors.accent}, source: {fontSize: 14, lineHeight: 23, color: colors.muted},
});
