import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../app/navigation/types';
import { colors } from '../theme/colors';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { CARD_PIXEL_WIDTH, MatchCard, RoundCard, cardPixelHeight } from '../components/ShareCards';
import { useSettingsStore, type ShareOptions } from '../../application/stores/settingsStore';
import { getMatchDetail } from '../../application/services/historyRepository';
import {
  captureCard,
  loadRoundPhotos,
  replayMatchDetail,
  roundPhotoName,
  saveCardImage,
  shareCardImage,
  type ReplayedRound,
} from '../../application/services/shareService';
import {
  pickRoundPhoto,
  shareCaption,
  shareFileName,
  summarizeMatch,
  type RoundPhotos,
} from '../../domain/share/shareCards';
import type { MatchDetail } from '../../domain/history/types';
import { highlightName } from '../../domain/share/highlights';

type Props = NativeStackScreenProps<RootStackParamList, 'SharePreview'>;

type Tab = 'round' | 'highlights' | 'match';

// MediaStore saves without a storage permission from Android 10 on; older phones only share.
const CAN_SAVE = Platform.OS === 'android' && Number(Platform.Version) >= 29;

const PREVIEW_SHARE_OF_HEIGHT = 0.56;

interface ChoiceProps<T extends string> {
  value: T;
  choices: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

const Choice = <T extends string>({ value, choices, onChange }: ChoiceProps<T>) => (
  <View style={styles.choice}>
    {choices.map(choice => (
      <Pressable
        key={choice.value}
        onPress={() => onChange(choice.value)}
        style={[styles.choiceItem, choice.value === value && styles.choiceItemActive]}>
        <Text style={[styles.choiceLabel, choice.value === value && styles.choiceLabelActive]}>
          {choice.label}
        </Text>
      </Pressable>
    ))}
  </View>
);

export const SharePreviewScreen = ({ route }: Props) => {
  const { round, matchId, highlight } = route.params;
  // From the finished game both a round and the match are given; the match summary comes
  // first there.
  const [tab, setTab] = useState<Tab>(
    highlight !== undefined ? 'highlights' : matchId !== undefined ? 'match' : 'round',
  );
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  // null until the saved match has been replayed.
  const [highlights, setHighlights] = useState<ReplayedRound[] | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | undefined>(highlight);
  // Kept highlight photos by name; a live round brings its own.
  const [storedPhotos, setStoredPhotos] = useState<Map<string, RoundPhotos>>(new Map());
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const options = useSettingsStore(state => state.shareOptions);
  const showUrl = useSettingsStore(state => state.shareShowUrl);
  const boardKind = useSettingsStore(state => state.boardKind);
  const selfMocking = useSettingsStore(state => state.highlightSelfMocking);
  const cardRef = useRef<View>(null);
  const window = useWindowDimensions();

  useEffect(() => {
    if (matchId === undefined) {
      return;
    }
    getMatchDetail(matchId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [matchId]);

  useEffect(() => {
    loadRoundPhotos()
      .then(setStoredPhotos)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!detail) {
      return;
    }
    let active = true;
    replayMatchDetail(detail, selfMocking)
      .then(rounds => {
        if (active) {
          const found = rounds.filter(item => item.share.highlight !== null);
          setHighlights(found);
          // Nothing to show on the highlights tab: fall back to the summary.
          if (found.length === 0) {
            setTab(current => (current === 'highlights' ? 'match' : current));
          }
        }
      })
      .catch(() => setHighlights([]));
    return () => {
      active = false;
    };
  }, [detail, selfMocking]);

  const pickedHighlight = highlights?.find(item => item.key === highlightKey) ?? highlights?.[0];
  const tabs: Array<{ value: Tab; label: string }> = [
    ...(round ? [{ value: 'round' as const, label: '这一轮' }] : []),
    ...(highlights && highlights.length > 0 ? [{ value: 'highlights' as const, label: '本场高光' }] : []),
    ...(matchId !== undefined ? [{ value: 'match' as const, label: '本场总结' }] : []),
  ];

  const matchShare = useMemo(
    () => (detail ? summarizeMatch(detail, options) : null),
    [detail, options],
  );

  // The card is laid out at its capture size (1080 px wide) and shown scaled down.
  const cardWidth = CARD_PIXEL_WIDTH / PixelRatio.get();
  const pixelHeight = cardPixelHeight(options.size);
  const cardHeight = (cardWidth * pixelHeight) / CARD_PIXEL_WIDTH;
  const scale = Math.min(
    (window.width - 40) / cardWidth,
    (window.height * PREVIEW_SHARE_OF_HEIGHT) / cardHeight,
  );

  const setOptions = (value: Partial<ShareOptions>) => {
    setMessage(null);
    useSettingsStore.getState().setShareOptions(value).catch(() => undefined);
  };

  const roundShare = tab === 'round' ? round : tab === 'highlights' ? pickedHighlight?.share : undefined;
  const photos = roundShare
    ? roundShare.photos ??
      storedPhotos.get(roundPhotoName(roundShare.createdAt, roundShare.roundNumber, roundShare.playerSeat)) ??
      null
    : null;
  const photo = roundShare ? pickRoundPhoto(photos, options.photo, roundShare.throws) : null;
  // A close-up choice without a close-up shows as the round board it falls back to.
  const photoChoice = options.photo === 'close' && !photos?.close ? 'full' : options.photo;
  const card =
    roundShare ? (
      <RoundCard
        share={roundShare}
        boardKind={boardKind}
        width={cardWidth}
        options={options}
        showUrl={showUrl}
        photo={photo}
      />
    ) : tab === 'match' && matchShare ? (
      <MatchCard share={matchShare} width={cardWidth} options={options} showUrl={showUrl} />
    ) : null;

  const run = async (action: 'share' | 'save') => {
    if (!card) {
      return;
    }
    setBusy(action);
    setMessage(null);
    try {
      const uri = await captureCard(cardRef, CARD_PIXEL_WIDTH, pixelHeight);
      const createdAt = roundShare?.createdAt ?? matchShare?.createdAt ?? Date.now();
      const fileName = shareFileName(roundShare ? 'round' : 'match', createdAt);
      if (action === 'share') {
        await shareCardImage(uri, fileName, shareCaption(options.language, showUrl));
      } else {
        await saveCardImage(uri, fileName);
        setMessage('已保存到相册（Pictures/BullTrack）');
      }
    } catch {
      setMessage(action === 'share' ? '分享失败，请重试' : '保存失败，请重试');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {tabs.length > 1 ? (
        <Choice
          value={tab}
          choices={tabs}
          onChange={value => {
            setMessage(null);
            setTab(value);
          }}
        />
      ) : null}

      {tab === 'highlights' && highlights && highlights.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightRow}>
          {highlights.map(item => {
            const active = item.key === pickedHighlight?.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setMessage(null);
                  setHighlightKey(item.key);
                }}
                style={[styles.highlightChip, active && styles.highlightChipActive]}>
                <Text style={[styles.highlightChipLabel, active && styles.highlightChipLabelActive]}>
                  {item.share.highlight ? highlightName(item.share.highlight) : ''} · {item.share.playerName} 第{' '}
                  {item.share.roundNumber} 轮
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={[styles.previewFrame, { width: cardWidth * scale, height: cardHeight * scale }]}>
        {card ? (
          <View style={[styles.previewCard, { width: cardWidth, height: cardHeight, transform: [{ scale }] }]}>
            <View ref={cardRef} collapsable={false}>
              {card}
            </View>
          </View>
        ) : (
          <Text style={styles.loading}>{matchId !== undefined && (!detail || (tab === 'highlights' && !highlights))
              ? '正在读取…'
              : '没有可分享的内容'}</Text>
        )}
      </View>

      <View style={styles.options}>
        {photos ? (
          <View style={styles.optionRow}>
            <Text style={styles.optionLabel}>照片</Text>
            <Choice
              value={photoChoice}
              choices={[
                { value: 'auto', label: '自动' },
                { value: 'full', label: '整靶' },
                ...(photos.close ? [{ value: 'close' as const, label: '特写' }] : []),
                { value: 'none', label: '不用' },
              ]}
              onChange={choice => setOptions({ photo: choice })}
            />
          </View>
        ) : null}
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>尺寸</Text>
          <Choice
            value={options.size}
            choices={[
              { value: 'portrait', label: '4:5' },
              { value: 'story', label: '9:16' },
            ]}
            onChange={size => setOptions({ size })}
          />
        </View>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>文字</Text>
          <Choice
            value={options.language}
            choices={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'EN' },
            ]}
            onChange={language => setOptions({ language })}
          />
        </View>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>显示名字</Text>
          <Switch
            value={options.showNames}
            onValueChange={showNames => setOptions({ showNames })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.panel}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={busy === 'share' ? '正在准备…' : '分享'}
          onPress={() => run('share')}
          disabled={!card || busy !== null}
        />
        {CAN_SAVE ? (
          <SecondaryButton
            label={busy === 'save' ? '正在保存…' : '存相册'}
            onPress={() => run('save')}
            disabled={!card || busy !== null}
          />
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
  },
  previewFrame: {
    alignSelf: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#15120F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: 'top left',
  },
  loading: {
    color: '#B8AD9C',
    fontSize: 14,
  },
  choice: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.panelStrong,
    borderRadius: 999,
    padding: 3,
  },
  choiceItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
  },
  choiceItemActive: {
    backgroundColor: colors.panel,
  },
  choiceLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  choiceLabelActive: {
    color: colors.textPrimary,
  },
  highlightRow: {
    gap: 8,
    paddingHorizontal: 2,
  },
  highlightChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  highlightChipActive: {
    borderColor: colors.accent,
  },
  highlightChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  highlightChipLabelActive: {
    color: colors.accent,
  },
  options: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  actions: {
    gap: 10,
  },
  message: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
