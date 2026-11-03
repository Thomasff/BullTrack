import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { BrandLine, CARD_COLORS, CARD_PIXEL_WIDTH, GRID, OUTFIT_BOLD, cardPixelHeight, fontFor } from './ShareCards';
import { HitMapBoard } from './HitMapBoard';
import type { CardOptions } from '../../application/stores/settingsStore';
import { formatShareDate } from '../../domain/share/shareCards';
import {
  statsText,
  type CardFigure,
  type PlayerStatsShare,
  type VersusShare,
} from '../../domain/share/statsCards';
import type { PlayerTrendPoint } from '../../domain/history/types';

const CHANGE_COLORS = { better: '#7BC47F', worse: '#E58F8F' };
// The head-to-head page's red and blue, lightened for the dark card.
const VERSUS_COLORS = { left: '#E5534B', right: '#4C9BE0' };
const MAX_TREND_DOTS = 31;

interface StatsCardProps {
  width: number;
  options: CardOptions;
  showUrl: boolean;
}

const cardFrame = (width: number, options: CardOptions, u: number) => ({
  width,
  height: (width * cardPixelHeight(options.size)) / CARD_PIXEL_WIDTH,
  padding: 20 * u,
});

const Header = ({ subtitle, title, u, options }: { subtitle: string; title: string | null; u: number; options: CardOptions }) => (
  <>
    <Text numberOfLines={1} style={[styles.muted, { fontSize: 11 * u }]}>
      {subtitle} · {formatShareDate(Date.now())}
    </Text>
    {title !== null ? (
      <Text numberOfLines={1} style={[styles.text, fontFor(options.language, 'bold'), { fontSize: 26 * u, marginTop: 2 * u }]}>
        {title}
      </Text>
    ) : null}
  </>
);

const Change = ({ figure, size }: { figure: CardFigure; size: number }) =>
  figure.change ? (
    <Text
      style={[
        styles.change,
        { fontSize: size, color: figure.change.better ? CHANGE_COLORS.better : CHANGE_COLORS.worse },
      ]}>
      {figure.change.text}
    </Text>
  ) : null;

// One figure: the value with its change, the label under it.
const Figure = ({ figure, u, valueSize, options }: { figure: CardFigure; u: number; valueSize: number; options: CardOptions }) => (
  <View>
    <View style={[styles.valueLine, { gap: 4 * u }]}>
      <Text style={[styles.number, { fontSize: valueSize * u, lineHeight: valueSize * 1.12 * u }]}>{figure.value}</Text>
      <Change figure={figure} size={Math.max(10, valueSize * 0.45) * u} />
    </View>
    <Text numberOfLines={1} style={[styles.muted, fontFor(options.language, 'medium'), { fontSize: 10 * u }]}>
      {figure.label}
    </Text>
  </View>
);

// The mode's main figure per day, oldest first, as a still line.
const CardTrend = ({ points, width, height, u }: { points: PlayerTrendPoint[]; width: number; height: number; u: number }) => {
  const values = points.map(point => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = 4 * u;
  const x = (index: number) => pad + (index / (points.length - 1)) * (width - 2 * pad);
  const y = (value: number) => pad + (max === min ? 0.5 : (max - value) / (max - min)) * (height - 2 * pad);
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${height} L ${x(0).toFixed(1)} ${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={CARD_COLORS.accent} fillOpacity={0.18} />
      <Path d={line} fill="none" stroke={CARD_COLORS.accent} strokeWidth={2 * u} strokeLinejoin="round" strokeLinecap="round" />
      {points.length <= MAX_TREND_DOTS
        ? points.map((point, index) => (
            <Circle key={point.day} cx={x(index)} cy={y(point.value)} r={2.2 * u} fill={CARD_COLORS.accent} />
          ))
        : null}
    </Svg>
  );
};

const formatDay = (day: number) => {
  const date = new Date(day);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

// A player's overview (hit map and a few figures) or one mode (main figure, more figures and
// the trend by day).
export const PlayerStatsCard = ({ share, width, options, showUrl }: StatsCardProps & { share: PlayerStatsShare }) => {
  const u = width / GRID;
  const story = options.size === 'story';
  const { language } = options;
  const changesNote = share.hasChanges ? (
    <Text style={[styles.muted, { fontSize: 9 * u, marginTop: 6 * u }]}>{statsText.changes(language)}</Text>
  ) : null;

  const body = share.main ? (
    <>
      <View style={{ marginTop: (story ? 40 : 14) * u }}>
        <View style={[styles.valueLine, { gap: 8 * u }]}>
          <Text style={[styles.number, { fontSize: (story ? 80 : 54) * u, lineHeight: (story ? 86 : 58) * u }]}>
            {share.main.value}
          </Text>
          <View style={{ marginBottom: 10 * u }}>
            <Change figure={share.main} size={16 * u} />
          </View>
        </View>
        <Text style={[styles.muted, fontFor(language, 'medium'), { fontSize: 13 * u }]}>{share.main.label}</Text>
      </View>
      {share.figures.length > 0 ? (
        <View style={[styles.grid, { marginTop: (story ? 24 : 12) * u, rowGap: 8 * u }]}>
          {share.figures.map(figure => (
            <View key={figure.label} style={styles.gridCell}>
              <Figure figure={figure} u={u} valueSize={20} options={options} />
            </View>
          ))}
        </View>
      ) : null}
      {changesNote}
      {share.trend.length >= 2 ? (
        <View style={{ marginTop: (story ? 32 : 12) * u }}>
          <Text style={[styles.muted, fontFor(language, 'medium'), { fontSize: 10 * u, marginBottom: 4 * u }]}>
            {share.trendTitle}
          </Text>
          <CardTrend points={share.trend} width={320 * u} height={(story ? 150 : 66) * u} u={u} />
          <View style={styles.trendDays}>
            <Text style={[styles.muted, { fontSize: 9 * u }]}>{formatDay(share.trend[0].day)}</Text>
            <Text style={[styles.muted, { fontSize: 9 * u }]}>{formatDay(share.trend[share.trend.length - 1].day)}</Text>
          </View>
        </View>
      ) : null}
    </>
  ) : (
    <>
      {share.segments.length > 0 ? (
        <View style={[styles.centered, { marginTop: (story ? 36 : 10) * u }]}>
          <HitMapBoard size={(story ? 300 : 222) * u} segments={share.segments} points={share.points} />
        </View>
      ) : null}
      <View style={[styles.figureRow, { marginTop: (story ? 30 : 12) * u }]}>
        {share.figures.map(figure => (
          <Figure key={figure.label} figure={figure} u={u} valueSize={24} options={options} />
        ))}
      </View>
      {share.hitLine ? (
        <Text numberOfLines={1} style={[styles.muted, fontFor(language, 'medium'), { fontSize: 10.5 * u, marginTop: 8 * u }]}>
          {share.hitLine}
        </Text>
      ) : null}
      {changesNote}
    </>
  );

  return (
    <View style={[styles.card, cardFrame(width, options, u)]}>
      <Header subtitle={share.subtitle} title={share.name} u={u} options={options} />
      {body}
      <View style={styles.flexFill} />
      <BrandLine u={u} language={language} showUrl={showUrl} />
    </View>
  );
};

// Mode table rows and compared figures that fit each size.
const MAX_MODE_ROWS = { portrait: 6, story: 10 };
const MAX_COMPARE_ROWS = { portrait: 5, story: 10 };

// Two players against each other: the score, recent results, and the modes they played or
// one mode's compared figures.
export const VersusCard = ({ share, width, options, showUrl }: StatsCardProps & { share: VersusShare }) => {
  const u = width / GRID;
  const story = options.size === 'story';
  const { language } = options;
  const modes = share.modes.slice(0, MAX_MODE_ROWS[options.size]);
  const rows = share.rows.slice(0, MAX_COMPARE_ROWS[options.size]);
  const name = (text: string, color: string, align: 'left' | 'right') => (
    <Text
      numberOfLines={1}
      style={[styles.flexFill, fontFor(language, 'bold'), { color, fontSize: 17 * u, textAlign: align }]}>
      {text}
    </Text>
  );

  return (
    <View style={[styles.card, cardFrame(width, options, u)]}>
      <Header subtitle={share.subtitle} title={null} u={u} options={options} />
      <View style={[styles.scoreRow, { gap: 12 * u, marginTop: (story ? 40 : 14) * u }]}>
        {name(share.leftName, VERSUS_COLORS.left, 'right')}
        <Text style={[styles.number, { fontSize: 44 * u, lineHeight: 50 * u }]}>
          {share.leftWins} : {share.rightWins}
        </Text>
        {name(share.rightName, VERSUS_COLORS.right, 'left')}
      </View>
      <Text style={[styles.muted, styles.centerText, fontFor(language, 'medium'), { fontSize: 10.5 * u }]}>
        {share.meta}
      </Text>
      {share.recent.length > 0 ? (
        <View style={[styles.dots, { gap: 5 * u, marginTop: 8 * u }]}>
          {share.recent.map((winner, index) => (
            <View
              key={index}
              style={[
                { width: 10 * u, height: 10 * u, borderRadius: 5 * u, borderWidth: 1.2 * u },
                winner === 'other'
                  ? styles.otherWon
                  : { borderColor: VERSUS_COLORS[winner], backgroundColor: VERSUS_COLORS[winner] },
              ]}
            />
          ))}
        </View>
      ) : null}
      {share.streak ? (
        <Text style={[styles.muted, styles.centerText, fontFor(language, 'medium'), { fontSize: 10.5 * u, marginTop: 4 * u }]}>
          {share.streak}
        </Text>
      ) : null}

      <View style={[styles.divider, { marginTop: (story ? 30 : 14) * u, marginBottom: 8 * u, height: 0.7 * u }]} />

      {modes.length > 0 ? (
        <View style={{ gap: (story ? 10 : 6) * u }}>
          <View style={styles.tableRow}>
            <Text style={[styles.cellName, styles.muted, fontFor(language, 'medium'), { fontSize: 10 * u }]}>
              {statsText.mode(language)}
            </Text>
            <Text numberOfLines={1} style={[styles.cell, fontFor(language, 'medium'), { fontSize: 10 * u, color: VERSUS_COLORS.left }]}>
              {share.leftName}
            </Text>
            <Text numberOfLines={1} style={[styles.cell, fontFor(language, 'medium'), { fontSize: 10 * u, color: VERSUS_COLORS.right }]}>
              {share.rightName}
            </Text>
          </View>
          {modes.map(mode => (
            <View key={mode.title} style={styles.tableRow}>
              <Text numberOfLines={1} style={[styles.cellName, styles.text, fontFor(language, 'medium'), { fontSize: 13 * u }]}>
                {mode.title}
              </Text>
              <Text style={[styles.cell, styles.number, { fontSize: 15 * u }]}>{mode.leftWins}</Text>
              <Text style={[styles.cell, styles.number, { fontSize: 15 * u }]}>{mode.rightWins}</Text>
            </View>
          ))}
          {share.modes.length > modes.length ? (
            <Text style={[styles.muted, { fontSize: 10 * u }]}>{statsText.moreModes(share.modes.length - modes.length, language)}</Text>
          ) : null}
        </View>
      ) : null}

      {rows.length > 0 ? (
        <View style={{ gap: (story ? 12 : 6) * u }}>
          {rows.map(row => {
            const largest = Math.max(Math.abs(row.left ?? 0), Math.abs(row.right ?? 0));
            const bar = (value: number | null, color: string, ahead: boolean) =>
              value === null || largest === 0 ? null : (
                <View
                  style={[
                    {
                      width: `${(Math.abs(value) / largest) * 100}%`,
                      height: 7 * u,
                      borderRadius: 3.5 * u,
                      backgroundColor: color,
                    },
                    !ahead && styles.barBehind,
                  ]}
                />
              );
            return (
              <View key={row.label}>
                <Text style={[styles.muted, styles.centerText, fontFor(language, 'medium'), { fontSize: 9.5 * u }]}>
                  {row.label}
                </Text>
                <View style={styles.compareLine}>
                  <Text
                    style={[
                      styles.compareValue,
                      row.leftAhead ? styles.text : styles.muted,
                      styles.valueLeft,
                      { width: 46 * u, fontSize: 13 * u, marginRight: 6 * u },
                    ]}>
                    {row.leftText}
                  </Text>
                  <View style={[styles.barHalf, styles.barHalfLeft]}>{bar(row.left, VERSUS_COLORS.left, row.leftAhead)}</View>
                  <View style={{ width: 1.5 * u, height: 11 * u, marginHorizontal: 2 * u, backgroundColor: CARD_COLORS.divider }} />
                  <View style={styles.barHalf}>{bar(row.right, VERSUS_COLORS.right, row.rightAhead)}</View>
                  <Text
                    style={[
                      styles.compareValue,
                      row.rightAhead ? styles.text : styles.muted,
                      { width: 46 * u, fontSize: 13 * u, marginLeft: 6 * u },
                    ]}>
                    {row.rightText}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

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
  text: {
    color: CARD_COLORS.text,
  },
  muted: {
    color: CARD_COLORS.muted,
  },
  number: {
    color: CARD_COLORS.text,
    fontFamily: OUTFIT_BOLD,
    includeFontPadding: false,
  },
  change: {
    fontFamily: OUTFIT_BOLD,
  },
  valueLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  centered: {
    alignItems: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  figureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    width: '50%',
  },
  trendDays: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  divider: {
    backgroundColor: CARD_COLORS.divider,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cellName: {
    flex: 2,
  },
  cell: {
    flex: 1,
    textAlign: 'center',
  },
  compareLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compareValue: {
    fontFamily: OUTFIT_BOLD,
  },
  barHalf: {
    flex: 1,
  },
  barHalfLeft: {
    alignItems: 'flex-end',
  },
  barBehind: {
    opacity: 0.3,
  },
  valueLeft: {
    textAlign: 'right',
  },
  otherWon: {
    borderColor: CARD_COLORS.muted,
  },
});
