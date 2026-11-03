import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import {
  getModeCategoryDescription,
  getModeCategoryTitle,
  modeCategories,
} from '../../domain/game/modeCatalog';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { StatsTab } from './StatsTab';
import { SettingsTab } from './SettingsTab';
import { BoardKindDialog } from '../components/BoardKindDialog';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type RootTabId = 'home' | 'stats' | 'settings';

// Titles are under setup.tabs.<id>.
const tabs: RootTabId[] = ['home', 'stats', 'settings'];

export const HomeScreen = ({ navigation }: Props) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<RootTabId>('home');
  const isFocused = useIsFocused();
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const settingsLoaded = useSettingsStore(state => state.loaded);
  const boardKind = useSettingsStore(state => state.boardKind);
  const boardKindChosen = useSettingsStore(state => state.boardKindChosen);
  const setBoardKind = useSettingsStore(state => state.setBoardKind);

  const renderHomeTab = () => (
    <ScrollView contentContainerStyle={styles.content}>
      {modeCategories.map(category => (
        <Pressable
          key={category.id}
          onPress={() => navigation.navigate('ModeSelect', { categoryId: category.id })}
          style={({ pressed }) => [styles.categoryCard, pressed && styles.categoryCardPressed]}>
          <Text style={styles.categoryTitle}>{getModeCategoryTitle(category.id)}</Text>
          <Text style={styles.categoryDescription}>
            {getModeCategoryDescription(category.id)}
          </Text>
        </Pressable>
      ))}
      {showDebugInfo ? (
        <Pressable onPress={() => navigation.navigate('Debug')} style={styles.debugLink}>
          <Text style={styles.debugLinkLabel}>{t('setup.viewDebug')}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>BullTrack</Text>
        </View>

        <View style={styles.main}>
          {activeTab === 'home' ? (
            renderHomeTab()
          ) : activeTab === 'stats' ? (
            // Remount on focus so a just-finished match shows up.
            isFocused ? (
              <StatsTab onOpenMatch={matchId => navigation.navigate('MatchDetail', { matchId })} />
            ) : null
          ) : (
            <SettingsTab />
          )}
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => {
            const selected = tab === activeTab;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={styles.tabButton}>
                <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                  {t(`setup.tabs.${tab}`)}
                </Text>
                <View style={[styles.tabIndicator, selected && styles.tabIndicatorSelected]} />
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* First launch: the player picks the board before anything else. */}
      <BoardKindDialog
        visible={settingsLoaded && !boardKindChosen}
        selected={boardKind}
        cancelable={false}
        onPick={kind => {
          setBoardKind(kind).catch(() => undefined);
        }}
        onCancel={() => undefined}
      />
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.panel,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  main: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  categoryCard: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 22,
    paddingHorizontal: 20,
    gap: 6,
  },
  categoryCardPressed: {
    backgroundColor: colors.panelStrong,
  },
  categoryTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  categoryDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  debugLink: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  debugLinkLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tabButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tabLabelSelected: {
    color: colors.accent,
  },
  tabIndicator: {
    width: 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  tabIndicatorSelected: {
    backgroundColor: colors.accent,
  },
});
