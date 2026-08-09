import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {ChevronDown, ChevronRight, X} from 'lucide-react-native';
import type {OutlineNode} from '../../domain/models';
import {colors} from '../theme';

interface Props {
  nodes: OutlineNode[];
  activeSectionId: string | null;
  generating: boolean;
  onSelect(node: OutlineNode): void;
  onClose(): void;
}

const statusLabels = {queued: '待生成', generating: '生成中', completed: '已完成', failed: '生成失败'} as const;

export default function OutlineDrawer({nodes, activeSectionId, generating, onSelect, onClose}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const byParent = useMemo(() => {
    const map = new Map<string | null, OutlineNode[]>();
    nodes.forEach(node => map.set(node.parentId, [...(map.get(node.parentId) ?? []), node]));
    return map;
  }, [nodes]);
  const completed = nodes.filter(node => node.status === 'completed').length;

  const renderNodes = (parentId: string | null): React.ReactNode => (byParent.get(parentId) ?? []).map(node => {
    const children = byParent.get(node.id) ?? [];
    const isCollapsed = collapsed.has(node.id);
    return (
      <View key={node.id}>
        <View style={[styles.node, {paddingLeft: 12 + Math.max(0, node.level - 1) * 14}, activeSectionId === node.id && styles.active]}>
          {children.length ? (
            <Pressable
              accessibilityLabel={`${isCollapsed ? '展开' : '折叠'} ${node.title}`}
              onPress={() => setCollapsed(current => {
                const next = new Set(current);
                next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                return next;
              })}
              style={styles.chevron}>
              {isCollapsed ? <ChevronRight size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
            </Pressable>
          ) : <View style={styles.chevron} />}
          <Pressable style={styles.nodeText} onPress={() => onSelect(node)}>
            <Text style={styles.nodeTitle}>{node.title}</Text>
            <Text testID={`generation-status-${node.id}`} style={[styles.status, node.status === 'failed' && styles.failed]}>{statusLabels[node.status]}</Text>
          </Pressable>
        </View>
        {!isCollapsed ? renderNodes(node.id) : null}
      </View>
    );
  });

  return (
    <View style={styles.drawer}>
      <View style={styles.header}>
        <View><Text style={styles.title}>文章大纲</Text><Text style={styles.progress}>已完成 {completed} / {nodes.length}</Text></View>
        <Pressable accessibilityLabel="关闭大纲" onPress={onClose} style={styles.close}><X size={22} color={colors.text} /></Pressable>
      </View>
      {generating ? <Text style={styles.generating}>正在生成下一节</Text> : null}
      <ScrollView contentContainerStyle={styles.list}>{renderNodes(null)}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {width: '88%', maxWidth: 360, height: '100%', backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border},
  header: {padding: 18, paddingTop: 22, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border},
  title: {fontSize: 20, fontWeight: '700', color: colors.text},
  progress: {fontSize: 13, color: colors.muted, marginTop: 4},
  close: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  generating: {paddingHorizontal: 18, paddingVertical: 10, color: colors.accent, backgroundColor: colors.accentSoft, fontWeight: '600'},
  list: {paddingVertical: 8},
  node: {minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingRight: 12},
  active: {backgroundColor: colors.accentSoft},
  chevron: {width: 30, height: 40, alignItems: 'center', justifyContent: 'center'},
  nodeText: {flex: 1, paddingVertical: 8},
  nodeTitle: {fontSize: 15, lineHeight: 20, color: colors.text},
  status: {fontSize: 12, color: colors.muted, marginTop: 3},
  failed: {color: colors.danger},
});
