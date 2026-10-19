import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { clearHistory } from '../../application/services/historyRepository';

export const SettingsTab = () => {
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const setShowDebugInfo = useSettingsStore(state => state.setShowDebugInfo);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearResult, setClearResult] = useState<'done' | 'failed' | null>(null);

  const clearAllHistory = () => {
    setConfirmingClear(false);
    clearHistory()
      .then(() => setClearResult('done'))
      .catch(() => setClearResult('failed'));
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
            thumbColor={colors.panel}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={() => {
            setClearResult(null);
            setConfirmingClear(true);
          }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={[styles.label, styles.danger]}>清空历史记录</Text>
            {clearResult ? (
              <Text style={[styles.description, clearResult === 'failed' && styles.danger]}>
                {clearResult === 'done' ? '已清空' : '清空失败，请重试'}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      <Text style={styles.footer}>BullTrack · 飞镖自动计分</Text>

      <ConfirmDialog
        visible={confirmingClear}
        title="清空历史记录"
        message="所有比赛和玩家统计都会被删除，且无法恢复。"
        confirmLabel="清空"
        cancelLabel="取消"
        danger
        onConfirm={clearAllHistory}
        onCancel={() => setConfirmingClear(false)}
      />
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
