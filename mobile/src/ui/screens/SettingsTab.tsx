import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { clearHistory } from '../../application/services/historyRepository';

export const SettingsTab = () => {
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const setShowDebugInfo = useSettingsStore(state => state.setShowDebugInfo);

  const confirmClearHistory = () => {
    Alert.alert('清空历史记录', '所有比赛和玩家统计都会被删除，且无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          clearHistory()
            .then(() => Alert.alert('已清空'))
            .catch(error =>
              Alert.alert('清空失败', error instanceof Error ? error.message : undefined),
            );
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>显示调试信息</Text>
            <Text style={styles.description}>对局页显示识别状态与调试图入口</Text>
          </View>
          <Switch
            value={showDebugInfo}
            onValueChange={value => {
              setShowDebugInfo(value).catch(() => undefined);
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={confirmClearHistory}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={[styles.label, styles.danger]}>清空历史记录</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>BullTrack · 飞镖自动计分</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 14,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  pressed: {
    backgroundColor: colors.panelStrong,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  danger: {
    color: colors.danger,
  },
  footer: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
  },
});
