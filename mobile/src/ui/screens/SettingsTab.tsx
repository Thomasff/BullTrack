import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BoardKindDialog } from '../components/BoardKindDialog';
import { LanguageDialog, languageLabel } from '../components/LanguageDialog';
import { BoardFace } from '../components/DartBoard';
import { PlacementGuide } from '../components/PlacementGuide';
import { useSettingsStore } from '../../application/stores/settingsStore';
import {
  clearHistory,
  exportHistory,
  importHistory,
} from '../../application/services/historyRepository';
import { playHapticTick, playSoundCue } from '../../application/services/liveRoundService';
import { bullTrackNativeBridge } from '../../native-bridge/bulltrack/bullTrackNative';
import { deleteMatchPhotos } from '../../application/services/shareService';
import {
  FEEDBACK_EMAIL,
  LICENSE_URL,
  PROJECT_URL,
  openFeedbackEmail,
  openUrl,
} from '../../application/services/feedback';
import { SHARE_URL } from '../../domain/share/shareCards';
import { GitHubIcon, LicenseIcon, MailIcon } from '../components/AboutIcons';
import { version } from '../../../package.json';

type BackupResult = { text: string; failed: boolean };

const VERSION_TAPS = 7;
const VERSION_TAP_GAP_MS = 1500;

const backupFileName = (now: Date) => {
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return `BullTrack-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
};

export const SettingsTab = () => {
  const { t } = useTranslation();
  const language = useSettingsStore(state => state.language);
  const setLanguage = useSettingsStore(state => state.setLanguage);
  const [pickingLanguage, setPickingLanguage] = useState(false);
  const developerMode = useSettingsStore(state => state.developerMode);
  const setDeveloperMode = useSettingsStore(state => state.setDeveloperMode);
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
  const shareShowUrl = useSettingsStore(state => state.shareShowUrl);
  const setShareShowUrl = useSettingsStore(state => state.setShareShowUrl);
  const highlightSelfMocking = useSettingsStore(state => state.highlightSelfMocking);
  const setHighlightSelfMocking = useSettingsStore(state => state.setHighlightSelfMocking);
  const boardKind = useSettingsStore(state => state.boardKind);
  const setBoardKind = useSettingsStore(state => state.setBoardKind);
  const [pickingBoard, setPickingBoard] = useState(false);
  const [showingGuide, setShowingGuide] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [confirmingDeveloperOff, setConfirmingDeveloperOff] = useState(false);
  const [clearResult, setClearResult] = useState<'done' | 'failed' | null>(null);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [noMailApp, setNoMailApp] = useState(false);
  const versionTaps = useRef({ count: 0, at: 0 });

  // Seven quick taps on the version line turn developer mode on.
  const tapVersion = () => {
    if (developerMode) {
      return;
    }
    const now = Date.now();
    const taps = versionTaps.current;
    taps.count = now - taps.at < VERSION_TAP_GAP_MS ? taps.count + 1 : 1;
    taps.at = now;
    if (taps.count >= VERSION_TAPS) {
      taps.count = 0;
      setDeveloperMode(true).catch(() => undefined);
    }
  };

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
      await bullTrackNativeBridge.shareTextFile(
        backupFileName(new Date()),
        content,
        t('native.share.backup'),
      );
      return null;
    }, t('settings.backupFailed'));

  const restoreHistory = () =>
    runBackupAction(async () => {
      const text = await bullTrackNativeBridge.pickTextFile();
      if (!text) {
        return null;
      }
      const result = await importHistory(text);
      if (result.status === 'invalid') {
        return t('settings.restoreInvalid');
      }
      return result.skipped > 0
        ? t('settings.restoreDoneSkipped', { added: result.added, skipped: result.skipped })
        : t('settings.restoreDone', { added: result.added });
    }, t('settings.restoreFailed'));

  const clearAllHistory = () => {
    setConfirmingClear(false);
    clearHistory()
      .then(() => {
        deleteMatchPhotos().catch(() => undefined);
        setClearResult('done');
      })
      .catch(() => setClearResult('failed'));
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {developerMode ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{t('settings.developerMode')}</Text>
              <Text style={styles.description}>{t('settings.developerModeDescription')}</Text>
            </View>
            <Switch
              value
              onValueChange={value => {
                if (!value) {
                  setConfirmingDeveloperOff(true);
                }
              }}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.panel}
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{t('settings.showDebugInfo')}</Text>
              <Text style={styles.description}>{t('settings.showDebugInfoDescription')}</Text>
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
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{t('settings.recordFrames')}</Text>
              <Text style={styles.description}>{t('settings.recordFramesDescription')}</Text>
            </View>
            <Switch
              value={recordFrames}
              onValueChange={setRecordFrames}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.panel}
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{t('settings.yoloOnCpu')}</Text>
              <Text style={styles.description}>{t('settings.yoloOnCpuDescription')}</Text>
            </View>
            <Switch
              value={yoloOnCpu}
              onValueChange={setYoloOnCpu}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.panel}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Pressable
          onPress={() => setPickingLanguage(true)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.language')}</Text>
          </View>
          <View style={styles.rowValue}>
            <Text style={styles.valueText}>{languageLabel(language, t('settings.languageSystem'))}</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setPickingBoard(true)}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.boardKind')}</Text>
            <Text style={styles.description}>{t('settings.boardKindDescription')}</Text>
          </View>
          <View style={styles.rowValue}>
            <BoardFace size={26} kind={boardKind} showNumbers={false} />
            <Text style={styles.valueText}>
              {boardKind === 'soft' ? t('common.boardSoft') : t('common.boardSteel')}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setShowingGuide(true)}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('guide.open')}</Text>
            <Text style={styles.description}>{t('guide.openDescription')}</Text>
          </View>
          <View style={styles.rowValue}>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>
        <View style={[styles.row, styles.rowDivider]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.soundCues')}</Text>
            <Text style={styles.description}>{t('settings.soundCuesDescription')}</Text>
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
            <Text style={styles.label}>{t('settings.vibration')}</Text>
            <Text style={styles.description}>{t('settings.vibrationDescription')}</Text>
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
        <View style={[styles.row, styles.rowDivider]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.shareShowUrl')}</Text>
            <Text style={styles.description}>{t('settings.shareShowUrlDescription')}</Text>
          </View>
          <Switch
            value={shareShowUrl}
            onValueChange={value => {
              setShareShowUrl(value).catch(() => undefined);
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.panel}
          />
        </View>
        <View style={[styles.row, styles.rowDivider]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.selfMocking')}</Text>
            <Text style={styles.description}>{t('settings.selfMockingDescription')}</Text>
          </View>
          <Switch
            value={highlightSelfMocking}
            onValueChange={value => {
              setHighlightSelfMocking(value).catch(() => undefined);
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
            <Text style={styles.label}>{t('settings.backup')}</Text>
            <Text style={styles.description}>{t('settings.backupDescription')}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={backupBusy}
          onPress={restoreHistory}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.restore')}</Text>
            <Text style={styles.description}>{t('settings.restoreDescription')}</Text>
            {backupBusy || backupResult ? (
              <Text
                style={[
                  styles.description,
                  styles.result,
                  backupResult?.failed && styles.danger,
                ]}>
                {backupBusy ? t('settings.working') : backupResult?.text}
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
            <Text style={[styles.label, styles.danger]}>{t('settings.clearHistory')}</Text>
            {clearResult ? (
              <Text style={[styles.description, clearResult === 'failed' && styles.danger]}>
                {clearResult === 'done' ? t('settings.clearDone') : t('settings.clearFailed')}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={() => {
            openFeedbackEmail()
              .then(opened => setNoMailApp(!opened))
              .catch(() => undefined);
          }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <MailIcon size={22} color={colors.textSecondary} />
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.feedback')}</Text>
            <Text style={styles.description}>{FEEDBACK_EMAIL}</Text>
            {noMailApp ? (
              <Text style={[styles.description, styles.result]}>{t('settings.feedbackNoMailApp')}</Text>
            ) : null}
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable
          onPress={() => openUrl(PROJECT_URL)}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
          <GitHubIcon size={22} color={colors.textSecondary} />
          <View style={styles.rowText}>
            <Text style={styles.label}>GitHub</Text>
            <Text style={styles.description}>{SHARE_URL}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable
          onPress={() => openUrl(LICENSE_URL)}
          style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressed]}>
          <LicenseIcon size={22} color={colors.textSecondary} />
          <View style={styles.rowText}>
            <Text style={styles.label}>{t('settings.license')}</Text>
            <Text style={styles.description}>{t('settings.licenseDescription')}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Pressable onPress={tapVersion}>
        <Text style={styles.footer}>{t('settings.footer', { version })}</Text>
        <Text style={styles.footerNote}>{t('settings.author')}</Text>
        {developerMode ? (
          <Text style={styles.footerNote}>{t('settings.developerModeOnNote')}</Text>
        ) : null}
      </Pressable>

      <ConfirmDialog
        visible={confirmingClear}
        title={t('settings.clearHistory')}
        message={t('settings.clearConfirmMessage')}
        confirmLabel={t('settings.clearConfirm')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={clearAllHistory}
        onCancel={() => setConfirmingClear(false)}
      />
      <ConfirmDialog
        visible={confirmingDeveloperOff}
        title={t('settings.developerOffTitle')}
        message={t('settings.developerOffMessage')}
        confirmLabel={t('settings.developerOffConfirm')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          setConfirmingDeveloperOff(false);
          setDeveloperMode(false).catch(() => undefined);
        }}
        onCancel={() => setConfirmingDeveloperOff(false)}
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
      <LanguageDialog
        visible={pickingLanguage}
        selected={language}
        onPick={choice => {
          setPickingLanguage(false);
          setLanguage(choice).catch(() => undefined);
        }}
        onCancel={() => setPickingLanguage(false)}
      />
      <PlacementGuide visible={showingGuide} onClose={() => setShowingGuide(false)} />
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
  footerNote: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
  },
});
