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

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type RootTabId = 'home' | 'stats' | 'settings';

const tabs: Array<{ id: RootTabId; title: string }> = [
  { id: 'home', title: '主页' },
  { id: 'stats', title: '统计' },
  { id: 'settings', title: '设置' },
];

export const HomeScreen = ({ navigation }: Props) => {
  const [activeTab, setActiveTab] = React.useState<RootTabId>('home');

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
              ? renderPlaceholderTab('统计', '统计页先保留为空白占位。')
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
