import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';
import { BoardFace, DART_MARKER_COLORS } from './DartBoard';
import { VIEW_RADIUS, markerPoint } from '../../domain/game/boardGeometry';
import type { ThrowResult } from '../../domain/game/types';
import type { BoardKind, CardOptions, ShareOptions } from '../../application/stores/settingsStore';
import {
  SHARE_URL,
  formatShareDate,
  modeName,
  playerLabel,
  shareText,
  winnerLine,
  type MatchShare,
  type RoundShare,
  type ShareLanguage,
} from '../../domain/share/shareCards';
import { highlightRibbon } from '../../domain/share/highlights';

// Cards are captured at 1080 px wide and laid out on a 360-unit grid (u = one unit).
export const CARD_PIXEL_WIDTH = 1080;
export const cardPixelHeight = (size: ShareOptions['size']) => (size === 'story' ? 1920 : 1350);
export const GRID = 360;

export const OUTFIT_BOLD = 'Outfit-Bold';
const OUTFIT_MEDIUM = 'Outfit-Medium';

export const CARD_COLORS = {
  background: '#15120F',
  text: '#F4F1E8',
  muted: '#B8AD9C',
  divider: '#2E2822',
  accent: '#C8282E',
  marker: '#15120F',
};

// Player lines on the match card; the first three match the dart markers.
const SIDE_COLORS = [...DART_MARKER_COLORS, '#9B8CF0', '#7BC47F', '#E58FB6', '#D9D9D9', '#C9A26B'];

interface CardProps {
  // Card width in layout units (dp); the height follows the size option.
  width: number;
  options: CardOptions;
  showUrl: boolean;
}

const AppIcon = ({ size }: { size: number }) => (
  <Svg width={size} height={size} viewBox="18 18 72 72">
    <Rect x={18} y={18} width={72} height={72} rx={16} fill={CARD_COLORS.accent} />
    <Circle cx={54} cy={54} r={15.6} fill="#F4F1E8" />
    <Circle cx={54} cy={54} r={10.8} fill={CARD_COLORS.accent} />
    <Circle cx={54} cy={54} r={6} fill="#F4F1E8" />
    <Circle cx={54} cy={54} r={2.4} fill="#1E1A16" />
    <Path
      d="M32.4,43.2V32.4H43.2M75.6,43.2V32.4H64.8M32.4,64.8V75.6H43.2M75.6,64.8V75.6H64.8"
      stroke="#F4F1E8"
      strokeWidth={4.2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const BrandLine = ({ u, language, showUrl }: { u: number; language: ShareLanguage; showUrl: boolean }) => (
  <View style={[styles.brand, { gap: 7 * u, paddingTop: 11 * u, borderTopWidth: 0.7 * u }]}>
    <AppIcon size={22 * u} />
    <View>
      <Text style={[styles.brandName, { fontSize: 13 * u }]}>BullTrack</Text>
      {showUrl ? (
        <Text style={[styles.muted, { fontSize: 8.5 * u }]}>
          {shareText.tagline(language)} · {SHARE_URL}
        </Text>
      ) : null}
    </View>
  </View>
);

// The virtual board with numbered markers, drawn like the game's board but not editable.
const ShareBoard = ({ size, throws, kind }: { size: number; throws: ThrowResult[]; kind: BoardKind }) => {
  const scale = size / 2 / VIEW_RADIUS;
  const marker = size * 0.068;
  return (
    <View style={{ width: size, height: size }}>
      <BoardFace size={size} kind={kind} />
      {throws.map((item, index) => {
        const point = markerPoint(item, index);
        return (
          <View
            key={index}
            style={[
              styles.marker,
              {
                width: marker,
                height: marker,
                borderRadius: marker / 2,
                borderWidth: marker * 0.09,
                left: size / 2 + point.x * scale - marker / 2,
                top: size / 2 + point.y * scale - marker / 2,
                backgroundColor: DART_MARKER_COLORS[index % DART_MARKER_COLORS.length],
              },
            ]}>
            <Text style={[styles.markerLabel, { fontSize: marker * 0.55 }]}>{index + 1}</Text>
          </View>
        );
      })}
    </View>
  );
};

const dartText = (item: ThrowResult, language: ShareLanguage) => {
  switch (item.ring) {
    case 'innerBull':
      return language === 'en' ? 'Bull' : '内牛';
    case 'outerBull':
      return language === 'en' ? '25' : '外牛';
    case 'miss':
      return language === 'en' ? 'Miss' : '脱靶';
    default:
      return item.label.startsWith('S') ? item.label.slice(1) : item.label;
  }
};

// Outfit for Latin text; Chinese text keeps the system font, which Outfit has no glyphs for.
export const fontFor = (language: ShareLanguage, weight: 'bold' | 'medium') =>
  language === 'en'
    ? { fontFamily: weight === 'bold' ? OUTFIT_BOLD : OUTFIT_MEDIUM }
    : { fontWeight: weight === 'bold' ? ('800' as const) : ('600' as const) };

// A photo on the round card: the round board ('full') or the close-up around the darts.
export interface CardPhoto {
  uri: string;
  kind: 'full' | 'close';
}

// Layout follows the photo: a round board photo on top with a small virtual board under it, a
// close-up next to the virtual board, or the virtual board alone.
export const RoundCard = ({
  share,
  boardKind,
  width,
  options,
  showUrl,
  photo,
}: CardProps & { share: RoundShare; boardKind: BoardKind; photo?: CardPhoto | null }) => {
  const u = width / GRID;
  const story = options.size === 'story';
  const { language } = options;
  const note = shareText.note(share.note, language);
  const meta = [
    playerLabel(share.playerName, share.playerSeat, options.showNames, language),
    modeName(share.mode, share.modeLabel, language),
    shareText.round(share.roundNumber, language),
  ].join(' · ');
  const chips = (
    <View style={{ gap: 6 * u }}>
      {share.throws.map((item, index) => (
        <View
          key={index}
          style={[
            styles.chip,
            {
              gap: 5 * u,
              borderWidth: 1 * u,
              paddingVertical: 2.5 * u,
              paddingLeft: 5 * u,
              paddingRight: 9 * u,
              borderColor: DART_MARKER_COLORS[index % DART_MARKER_COLORS.length],
            },
          ]}>
          <View
            style={{
              width: 7 * u,
              height: 7 * u,
              borderRadius: 3.5 * u,
              backgroundColor: DART_MARKER_COLORS[index % DART_MARKER_COLORS.length],
            }}
          />
          <Text style={[styles.chipLabel, fontFor(language, 'medium'), { fontSize: 11.5 * u }]}>
            {dartText(item, language)}
          </Text>
        </View>
      ))}
    </View>
  );

  // A 4:5 card has no room to spare: the top picture gives up the ribbon's height.
  let top: React.ReactNode;
  if (photo?.kind === 'full') {
    const side = (story ? 300 : share.highlight ? 216 : 236) * u;
    top = (
      <View style={[styles.boardArea, story && styles.photoAreaStory]}>
        <Image source={{ uri: photo.uri }} fadeDuration={0} style={{ width: side, height: side, borderRadius: side / 2 }} />
      </View>
    );
  } else if (photo?.kind === 'close') {
    const side = 156 * u;
    top = (
      <View style={[styles.pair, { gap: 8 * u }, story && styles.boardAreaStory]}>
        <Image source={{ uri: photo.uri }} fadeDuration={0} style={{ width: side, height: side, borderRadius: 10 * u }} />
        <ShareBoard size={side} throws={share.throws} kind={boardKind} />
      </View>
    );
  } else {
    top = (
      <View style={[styles.boardArea, story && styles.boardAreaStory]}>
        <ShareBoard size={(story ? 320 : share.highlight ? 238 : 262) * u} throws={share.throws} kind={boardKind} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { width, height: (width * cardPixelHeight(options.size)) / CARD_PIXEL_WIDTH, padding: 20 * u },
      ]}>
      {top}
      <View style={{ marginTop: (story ? 22 : 8) * u }}>
        {share.highlight ? (
          <View style={[styles.ribbon, { paddingHorizontal: 8 * u, paddingVertical: 2.5 * u, borderRadius: 3 * u, marginBottom: 7 * u }]}>
            <Text style={[styles.ribbonLabel, { fontSize: 11 * u, letterSpacing: 1.2 * u }]}>
              {highlightRibbon(share.highlight)}
            </Text>
          </View>
        ) : null}
        <Text numberOfLines={1} style={[styles.muted, { fontSize: 11 * u }]}>
          {meta}
        </Text>
        <View style={[styles.scoreRow, { gap: 10 * u }]}>
          <View style={styles.scoreMain}>
            <View style={[styles.valueLine, { gap: 6 * u }]}>
              <Text style={[styles.bigNumber, { fontSize: (story ? 78 : 62) * u, lineHeight: (story ? 84 : 68) * u }]}>
                {share.value}
              </Text>
              <Text style={[styles.unit, fontFor(language, 'medium'), { fontSize: 15 * u, marginBottom: 10 * u }]}>
                {shareText.unit(share.unit, language)}
              </Text>
            </View>
            {note ? (
              <Text
                style={[
                  styles.note,
                  fontFor(language, 'bold'),
                  share.note?.kind === 'left' ? null : styles.noteStrong,
                  { fontSize: 13 * u },
                ]}>
                {note}
              </Text>
            ) : null}
          </View>
          {chips}
          {photo?.kind === 'full' ? (
            <ShareBoard size={(story ? 104 : 88) * u} throws={share.throws} kind={boardKind} />
          ) : null}
        </View>
      </View>
      <View style={styles.flexFill} />
      <BrandLine u={u} language={language} showUrl={showUrl} />
    </View>
  );
};

// Per-round line chart: score left in X01 (from the start score down to 0), round totals
// otherwise.
const TrendChart = ({
  share,
  width,
  height,
  u,
}: {
  share: MatchShare;
  width: number;
  height: number;
  u: number;
}) => {
  const maxRounds = Math.max(1, ...share.sides.map(side => side.trend.length));
  const top = share.trendStart ?? Math.max(1, ...share.sides.flatMap(side => side.trend));
  const pad = 4 * u;
  const x = (index: number) => pad + ((width - 2 * pad) * index) / Math.max(1, maxRounds - (share.trendStart !== null ? 0 : 1));
  const y = (value: number) => pad + (height - 2 * pad) * (1 - value / top);
  return (
    <Svg width={width} height={height}>
      <Path d={`M ${pad} ${y(0)} H ${width - pad}`} stroke={CARD_COLORS.divider} strokeWidth={0.7 * u} />
      {share.sides.map((side, index) => {
        const values = share.trendStart !== null ? [share.trendStart, ...side.trend] : side.trend;
        if (values.length === 0) {
          return null;
        }
        const points = values.map((value, at) => `${x(at).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
        return (
          <Polyline
            key={side.seat}
            points={points}
            fill="none"
            stroke={SIDE_COLORS[index % SIDE_COLORS.length]}
            strokeWidth={2 * u}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
};

const MAX_SIDE_ROWS = 4;

export const MatchCard = ({ share, width, options, showUrl }: CardProps & { share: MatchShare }) => {
  const u = width / GRID;
  const story = options.size === 'story';
  const { language } = options;
  const title = winnerLine(share, language) ?? share.title;
  const rows = share.sides.slice(0, MAX_SIDE_ROWS);
  const hidden = share.sides.length - rows.length;
  return (
    <View
      style={[
        styles.card,
        { width, height: (width * cardPixelHeight(options.size)) / CARD_PIXEL_WIDTH, padding: 20 * u },
      ]}>
      <Text style={[styles.muted, { fontSize: 11 * u }]}>
        {share.title} · {formatShareDate(share.createdAt)}
      </Text>
      <Text numberOfLines={2} style={[styles.title, fontFor(language, 'bold'), { fontSize: 26 * u, marginTop: 2 * u }]}>
        {title}
      </Text>
      <View style={{ marginTop: (story ? 26 : 14) * u, gap: (story ? 16 : 10) * u }}>
        {rows.map((side, index) => (
          <View key={side.seat} style={[styles.sideRow, { gap: 8 * u }]}>
            <View
              style={{
                width: 9 * u,
                height: 9 * u,
                borderRadius: 4.5 * u,
                marginTop: 6 * u,
                backgroundColor: SIDE_COLORS[index % SIDE_COLORS.length],
              }}
            />
            <View style={styles.flexFill}>
              <Text numberOfLines={1} style={[styles.sideName, { fontSize: 15 * u }]}>
                {side.isWinner ? '🏆 ' : ''}
                {side.name}
              </Text>
              <Text numberOfLines={1} style={[styles.muted, { fontSize: 10 * u, marginTop: 1 * u }]}>
                {side.stats.map(stat => `${stat.label} ${stat.value}`).join('  ·  ')}
              </Text>
            </View>
            {side.finalScore !== null ? (
              <Text style={[styles.bigNumber, { fontSize: 30 * u, lineHeight: 34 * u }]}>{side.finalScore}</Text>
            ) : null}
          </View>
        ))}
        {hidden > 0 ? (
          <Text style={[styles.muted, { fontSize: 10 * u }]}>
            {language === 'en' ? `+${hidden} more` : `另有 ${hidden} 人`}
          </Text>
        ) : null}
      </View>
      <View style={[styles.chartArea, { marginTop: 14 * u }]}>
        <TrendChart share={share} width={320 * u} height={(story ? 300 : 130) * u} u={u} />
      </View>
      <View style={styles.flexFill} />
      <BrandLine u={u} language={language} showUrl={showUrl} />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_COLORS.background,
    overflow: 'hidden',
  },
  flexFill: {
    flex: 1,
  },
  boardArea: {
    alignItems: 'center',
  },
  boardAreaStory: {
    marginTop: '18%',
  },
  photoAreaStory: {
    marginTop: '14%',
  },
  pair: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  muted: {
    color: CARD_COLORS.muted,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: CARD_COLORS.divider,
  },
  brandName: {
    color: CARD_COLORS.text,
    fontFamily: OUTFIT_BOLD,
  },
  marker: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: CARD_COLORS.marker,
  },
  markerLabel: {
    color: CARD_COLORS.marker,
    fontFamily: OUTFIT_BOLD,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  scoreMain: {
    flex: 1,
  },
  valueLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bigNumber: {
    color: CARD_COLORS.text,
    fontFamily: OUTFIT_BOLD,
    includeFontPadding: false,
  },
  unit: {
    color: CARD_COLORS.muted,
  },
  note: {
    color: CARD_COLORS.muted,
  },
  noteStrong: {
    color: CARD_COLORS.accent,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
  },
  chipLabel: {
    color: CARD_COLORS.text,
  },
  title: {
    color: CARD_COLORS.text,
  },
  ribbon: {
    alignSelf: 'flex-start',
    backgroundColor: CARD_COLORS.accent,
  },
  ribbonLabel: {
    color: '#FFFFFF',
    fontFamily: OUTFIT_BOLD,
  },
  sideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sideName: {
    color: CARD_COLORS.text,
    fontWeight: '700',
  },
  chartArea: {
    alignItems: 'center',
  },
});
