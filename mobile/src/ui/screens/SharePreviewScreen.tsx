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
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../app/navigation/types';
import { colors } from '../theme/colors';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { CARD_PIXEL_WIDTH, MatchCard, RoundCard, cardPixelHeight } from '../components/ShareCards';
import { PlayerStatsCard, VersusCard } from '../components/StatsCards';
import { previousRange, rangeStart } from './PlayerDetailScreen';
import {
  useSettingsStore,
  type CardOptions,
  type ShareOptions,
} from '../../application/stores/settingsStore';
import { currentLanguage, type AppLanguage } from '../../i18n';
import {
  getHeadToHead,
  getMatchDetail,
  getPlayerDetail,
} from '../../application/services/historyRepository';
import {
  captureCard,
  releaseCardImage,
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
import type { HeadToHead, MatchDetail, PlayerDetail } from '../../domain/history/types';
import { summarizePlayerStats, summarizeVersus } from '../../domain/share/statsCards';
import { highlightName } from '../../domain/share/highlights';
import { displayPlayerName } from '../../domain/game/players';

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
  const { t } = useTranslation();
  const { round, matchId, highlight, player, versus } = route.params;
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
  // The stats cards' data; previous is the 30 days before the recent range.
  const [playerStats, setPlayerStats] = useState<{ detail: PlayerDetail; previous: PlayerDetail | null } | null>(
    null,
  );
  const [versusRecord, setVersusRecord] = useState<HeadToHead | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const savedOptions = useSettingsStore(state => state.shareOptions);
  // Each share starts in the app language; switching it here is not remembered.
  const [language, setLanguage] = useState<AppLanguage>(currentLanguage);
  const options: CardOptions = useMemo(() => ({ ...savedOptions, language }), [savedOptions, language]);
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
    if (!player) {
      return;
    }
    const previous = player.range === 'recent' ? previousRange() : null;
    Promise.all([
      getPlayerDetail(player.playerId, rangeStart(player.range)),
      previous ? getPlayerDetail(player.playerId, previous.since, null, previous.until) : null,
    ])
      .then(([current, before]) => setPlayerStats(current ? { detail: current, previous: before } : null))
      .catch(() => setPlayerStats(null))
      .finally(() => setStatsLoaded(true));
  }, [player]);

  useEffect(() => {
    if (!versus) {
      return;
    }
    getHeadToHead(versus.playerId, versus.opponentId, rangeStart(versus.range))
      .then(setVersusRecord)
      .catch(() => setVersusRecord(null))
      .finally(() => setStatsLoaded(true));
  }, [versus]);

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
    ...(round ? [{ value: 'round' as const, label: t('share.tabRound') }] : []),
    ...(highlights && highlights.length > 0 ? [{ value: 'highlights' as const, label: t('share.tabHighlights') }] : []),
    ...(matchId !== undefined ? [{ value: 'match' as const, label: t('share.tabMatch') }] : []),
  ];

  const matchShare = useMemo(
    () => (detail ? summarizeMatch(detail, options) : null),
    [detail, options],
  );
  const playerShare = useMemo(
    () =>
      player && playerStats
        ? summarizePlayerStats(playerStats.detail, playerStats.previous, player.mode, player.range, options)
        : null,
    [player, playerStats, options],
  );
  const versusShare = useMemo(
    () => (versus && versusRecord ? summarizeVersus(versusRecord, versus.mode, versus.range, options) : null),
    [versus, versusRecord, options],
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
  const card = playerShare ? (
    <PlayerStatsCard share={playerShare} width={cardWidth} options={options} showUrl={showUrl} />
  ) : versusShare ? (
    <VersusCard share={versusShare} width={cardWidth} options={options} showUrl={showUrl} />
  ) : roundShare ? (
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
    let uri: string | null = null;
    try {
      uri = await captureCard(cardRef, CARD_PIXEL_WIDTH, pixelHeight);
      const createdAt = roundShare?.createdAt ?? matchShare?.createdAt ?? Date.now();
      const fileName = shareFileName(
        playerShare ? 'stats' : versusShare ? 'versus' : roundShare ? 'round' : 'match',
        createdAt,
      );
      if (action === 'share') {
        await shareCardImage(uri, fileName, shareCaption(options.language, showUrl));
      } else {
        await saveCardImage(uri, fileName);
        setMessage(t('share.savedToGallery'));
      }
    } catch {
      setMessage(action === 'share' ? t('share.shareFailed') : t('share.saveFailed'));
    } finally {
      if (uri) {
        releaseCardImage(uri);
      }
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
                  {t('share.highlightChip', {
                    highlight: item.share.highlight ? highlightName(item.share.highlight) : '',
                    name: displayPlayerName(item.share.playerName),
                    round: item.share.roundNumber,
                  })}
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
          <Text style={styles.loading}>{((player || versus) && !statsLoaded) ||
            (matchId !== undefined && (!detail || (tab === 'highlights' && !highlights)))
              ? t('share.loading')
              : t('share.nothingToShare')}</Text>
        )}
      </View>

      <View style={styles.options}>
        {photos ? (
          <View style={styles.optionRow}>
            <Text style={styles.optionLabel}>{t('share.photo')}</Text>
            <Choice
              value={photoChoice}
              choices={[
                { value: 'auto', label: t('share.photoAuto') },
                { value: 'full', label: t('share.photoFull') },
                ...(photos.close ? [{ value: 'close' as const, label: t('share.photoClose') }] : []),
                { value: 'none', label: t('share.photoNone') },
              ]}
              onChange={choice => setOptions({ photo: choice })}
            />
          </View>
        ) : null}
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>{t('share.size')}</Text>
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
          <Text style={styles.optionLabel}>{t('share.cardLanguage')}</Text>
          <Choice
            value={options.language}
            choices={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'EN' },
            ]}
            onChange={choice => {
              setMessage(null);
              setLanguage(choice);
            }}
          />
        </View>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>{t('share.showNames')}</Text>
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
          label={busy === 'share' ? t('share.preparing') : t('share.share')}
          onPress={() => run('share')}
          disabled={!card || busy !== null}
        />
        {CAN_SAVE ? (
          <SecondaryButton
            label={busy === 'save' ? t('share.saving') : t('share.saveToGallery')}
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
    // The choices drop below the label when they do not fit beside it (English, narrow phones).
    flexWrap: 'wrap',
    rowGap: 6,
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
