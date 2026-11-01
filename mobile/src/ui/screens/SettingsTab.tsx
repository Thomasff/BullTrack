import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BoardKindDialog } from '../components/BoardKindDialog';
import { BoardFace } from '../components/DartBoard';
import { useSettingsStore } from '../../application/stores/settingsStore';
import {
  clearHistory,
  exportHistory,
  importHistory,
} from '../../application/services/historyRepository';
import { playHapticTick, playSoundCue } from '../../application/services/liveRoundService';
import { bullTrackNativeBridge } from '../../native-bridge/bulltrack/bullTrackNative';

type BackupResult = { text: string; failed: boolean };

const backupFileName = (now: Date) => {
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return `BullTrack-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
};

export const SettingsTab = () => {
  const showDebugInfo = useSettingsStore(state => state.showDebugInfo);
  const setShowDebugInfo = useSettingsStore(state => state.setShowDebugInfo);
  const recordFrames = useSettingsStore(state => state.recordFrames);
  const setRecordFrames = useSettingsStore(state => state.setRecordFrames);
  const yoloOnCpu = useSettingsStore(state => state.yoloOnCpu);
  const setYoloOnCpu = useSettingsStore(state => state.setYoloOnCpu);
  const soundCues = useSettingsStore(state => state.soundCues);
  const setSoundCues = useSettingsStore(state => state.setSoundCues);
  const vibration = useSettingsStore(state => state.vibration);
  const setVibration = useSettingsStore(state => state.setVibration);
  const boardKind = useSettingsStore(state => state.boardKind);
  const setBoardKind = useSettingsStore(state => state.setBoardKind);
  const [pickingBoard, setPickingBoard] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearResult, setClearResult] = useState<'done' | 'failed' | null>(null);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);

  const runBackupAction = (action: () => Promise<string | null>, failedText: string) => {
    if (backupBusy) {
      return;
    }
    setBackupBusy(true);
    setBackupResult(null);
    action()
      .then(text => setBackupResult(text ? { text, failed: false } : null))
      .catch(() => setBackupResult({ text: failedText, failed: true }))
      .finally(() => setBackupBusy(false));
  };

  const backUpHistory = () =>
    runBackupAction(async () => {
      const content = await exportHistory();
      await bullTrackNativeBridge.shareTextFile(backupFileName(new Date()), content);
      return null;
    }, '备份失败，请重试');

  const restoreHistory = () =>
    runBackupAction(async () => {
      const text = await bullTrackNativeBridge.pickTextFile();
      if (!text) {
        return null;
      }
      const result = await importHistory(text);
      if (result.status === 'invalid') {
        return '这不是 BullTrack 的备份文件';
      }
      return result.skipped > 0
        ? `已导入 ${result.added} 场比赛，${result.skipped} 场已存在`
        : `已导入 ${result.added} 场比赛`;
    }, '导入失败，请重试');

  const clearAllHistory = () => {
    setConfirmingClear(false);
    clearHistory()
      .then(() => setClearResult('done'))
      .catch(() => setClearResult('failed'));
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Pressable
          onPress={() => setPickingBoard(true)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>靶子类型</Text>
            <Text style={styles.description}>按你的靶子选，影响圈线判定和对局里的靶图</Text>
          </View>
          <View style={styles.rowValue}>
            <BoardFace size={26} kind={boardKind} showNumbers={false} />
            <Text style={styles.valueText}>{boardKind === 'soft' ? '软靶' : '硬靶'}</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>
        <View style={[styles.row, styles.rowDivider]}>
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
        {showDebugInfo ? (
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>识别用 CPU</Text>
              <Text style={styles.description}>
                开发用：飞镖识别改在 CPU 上跑（默认 GPU），用来比较速度和耗电。每轮的平均电流和功率记在调试日志里，重启 App 后自动关闭
              </Text>
            </View>
            <Switch
              value={yoloOnCpu}
              onValueChange={setYoloOnCpu}
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
        <View style={[styles.row, styles.rowDivider]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>震动</Text>
            <Text style={styles.description}>拖动飞镖标记时，每进入一个新区域轻震一下</Text>
          </View>
          <Switch
            value={vibration}
            onValueChange={value => {
              setVibration(value).catch(() => undefined);
              if (value) {
                // Let the player feel what the tick is like.
                playHapticTick();
              }
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.panel}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Pressable
          disabled={backupBusy}
          onPress={backUpHistory}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>备份历史记录</Text>
            <Text style={styles.description}>导出成一个文件，可发到微信、网盘或存到手机</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={backupBusy}
          onPress={restoreHistory}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>从备份导入</Text>
            <Text style={styles.description}>合并到现有记录，已有的比赛不会重复</Text>
            {backupBusy || backupResult ? (
              <Text
                style={[
                  styles.description,
                  styles.result,
                  backupResult?.failed && styles.danger,
                ]}>
                {backupBusy ? '处理中…' : backupResult?.text}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            setClearResult(null);
            setConfirmingClear(true);
          }}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
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
      <BoardKindDialog
        visible={pickingBoard}
        selected={boardKind}
        cancelable
        onPick={kind => {
          setPickingBoard(false);
          setBoardKind(kind).catch(() => undefined);
        }}
        onCancel={() => setPickingBoard(false)}
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
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  valueText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  chevron: {
    fontSize: 20,
    color: colors.textSecondary,
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
  result: {
    color: colors.textPrimary,
    marginTop: 2,
  },
  footer: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
  },
});
