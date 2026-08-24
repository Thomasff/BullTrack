import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Panel } from '../components/Panel';
import { SecondaryButton } from '../components/SecondaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { modeCategories } from '../../domain/game/modeCatalog';
import { listRecentMatches } from '../../application/services/historyRepository';
import type { RecentMatchSummary } from '../../domain/history/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type RootTabId = 'home' | 'stats' | 'settings';

const tabs: Array<{ id: RootTabId; title: string }> = [
  { id: 'home', title: '主页' },
  { id: 'stats', title: '统计' },
  { id: 'settings', title: '设置' },
];

export const HomeScreen = ({ navigation }: Props) => {
  const [activeTab, setActiveTab] = React.useState<RootTabId>('home');
  const [recentMatches, setRecentMatches] = React.useState<RecentMatchSummary[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (activeTab !== 'stats') {
      return;
    }

    let isMounted = true;
    setIsHistoryLoading(true);
    setHistoryError(null);
    listRecentMatches()
      .then(matches => {
        if (isMounted) {
          setRecentMatches(matches);
        }
      })
      .catch(error => {
        if (isMounted) {
          setHistoryError(error instanceof Error ? error.message : '读取历史失败');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsHistoryLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab]);

  const formatMatchTime = (createdAt: number) =>
    new Date(createdAt).toLocaleString();

  const renderHomeTab = () => (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="主页"
        title="选择比赛分类"
        description="先进入一个大类，再选择具体玩法，随后设置人数并进入现有对局流程。"
      />

      <View style={styles.categoryList}>
        {modeCategories.map(category => (
          <Pressable
            key={category.id}
            onPress={() => navigation.navigate('ModeSelect', { categoryId: category.id })}
            style={({ pressed }) => [
              styles.categoryCard,
              pressed && styles.categoryCardPressed,
            ]}>
            <Text style={styles.categoryTitle}>{category.title}</Text>
            <Text style={styles.categoryDescription}>{category.description}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actionGroup}>
        <SecondaryButton
          label="查看调试图"
          onPress={() => navigation.navigate('Debug')}
        />
      </View>
    </ScrollView>
  );

  const renderStatsTab = () => (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader
        eyebrow="统计"
        title="最近比赛"
        description="当前先展示本机已完成并保存的对局，后续再扩展玩家统计和比赛详情。"
      />
      {isHistoryLoading ? (
        <Panel>
          <Text style={styles.body}>正在读取历史...</Text>
        </Panel>
      ) : historyError ? (
        <Panel>
          <Text style={styles.errorText}>读取历史失败：{historyError}</Text>
        </Panel>
      ) : recentMatches.length === 0 ? (
        <Panel>
          <Text style={styles.body}>暂无已保存的完整对局。</Text>
        </Panel>
      ) : (
        <View style={styles.matchList}>
          {recentMatches.map(match => (
            <Panel key={match.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.panelTitle}>{match.modeLabel ?? match.mode}</Text>
                <Text style={styles.body}>{match.playerCount} 人</Text>
              </View>
              <Text style={styles.body}>{formatMatchTime(match.createdAt)}</Text>
              <Text style={styles.bodyStrong}>
                Winner: {match.winnerName ?? '未记录'}
              </Text>
            </Panel>
          ))}
        </View>
      )}
    </ScrollView>
  );

  const renderPlaceholderTab = (title: string, description: string) => (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <SectionHeader eyebrow={title} title={title} description={description} />
      <Panel>
        <Text style={styles.body}>当前页面暂不展示内容，后续再补充功能。</Text>
      </Panel>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>BullTrack Mobile</Text>
        </View>

        <View style={styles.main}>
          {activeTab === 'home'
            ? renderHomeTab()
            : activeTab === 'stats'
              ? renderStatsTab()
              : renderPlaceholderTab('设置', '设置页先保留为空白占位。')}
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => {
            const selected = tab.id === activeTab;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[styles.tabButton, selected && styles.tabButtonSelected]}>
                <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                  {tab.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.panel,
  },
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  main: {
    flex: 1,
  },
  screen: {
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.danger,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  matchList: {
    gap: 12,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  categoryList: {
    gap: 14,
  },
  categoryCard: {
    backgroundColor: colors.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
  },
  categoryCardPressed: {
    opacity: 0.92,
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  categoryDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  actionGroup: {
    gap: 12,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelStrong,
  },
  tabButtonSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tabLabelSelected: {
    color: '#FFF9F1',
  },
});
