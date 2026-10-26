import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useSettingsStore } from '../../application/stores/settingsStore';
import { clearHistory } from '../../application/services/historyRepository';
import { playSoundCue } from '../../application/services/liveRoundService';

export const SettingsTab = () => {
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const setShowDebugInfo = useSettingsStore(state => state.setShowDebugInfo);
  const recordFrames = useSettingsStore(state => state.recordFrames);
  const setRecordFrames = useSettingsStore(state => state.setRecordFrames);
  const soundCues = useSettingsStore(state => state.soundCues);
  const setSoundCues = useSettingsStore(state => state.setSoundCues);
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
        {showDebugInfo ? (
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>录制原始画面</Text>
              <Text style={styles.description}>
                开发用：每轮保存拍到的画面，供以后离线测试识别。耗电和占用存储会增加，重启 App 后自动关闭
              </Text>
            </View>
            <Switch
              value={recordFrames}
              onValueChange={setRecordFrames}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.panel}
            />
          </View>
        ) : null}
        <View style={[styles.row, styles.rowDivider]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>提示音</Text>
            <Text style={styles.description}>可以投镖、识别到一镖、出错时发出落镖声</Text>
          </View>
          <Switch
            value={soundCues}
            onValueChange={value => {
              setSoundCues(value).catch(() => undefined);
              if (value) {
                // Let the player hear what the cue sounds like.
                playSoundCue('dart');
              }
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
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
