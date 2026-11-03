import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import type { PlayerCricketStats, PlayerX01Stats } from '../../domain/history/types';

export const formatRate = (wins: number, played: number) =>
  `${Math.round((wins / Math.max(1, played)) * 100)}%`;

export const StatTile = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.tile}>
    <Text style={styles.tileValue}>{value}</Text>
    <Text style={styles.tileLabel}>{label}</Text>
  </View>
);

export const StatTiles = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.tiles}>{children}</View>
);

// One row of round counts, e.g. per score band.
const BandRow = ({ bands }: { bands: Array<{ label: string; count: number }> }) => (
  <View style={styles.bands}>
    {bands.map(band => (
      <View key={band.label} style={styles.band}>
        <Text style={styles.bandValue}>{band.count}</Text>
        <Text style={styles.bandLabel}>{band.label}</Text>
      </View>
    ))}
  </View>
);

// Rounds per mark count, from 5 marks up.
export const CricketMarkRounds = ({ stats }: { stats: PlayerCricketStats }) => {
  const { t } = useTranslation();
  return (
    <BandRow
      bands={stats.markRounds.map((count, index) => ({ label: t('stats.markRounds', { n: index + 5 }), count }))}
    />
  );
};

// X01 tiles plus a row counting rounds per score band.
export const X01StatBlock = ({ stats }: { stats: PlayerX01Stats }) => {
  const { t } = useTranslation();
  const bands = [
    { label: '60–99', count: stats.count60 },
    { label: '100–139', count: stats.count100 },
    { label: '140–179', count: stats.count140 },
    { label: '180', count: stats.count180 },
  ];
  return (
    <>
      <StatTiles>
        <StatTile label={t('stats.figures.average')} value={stats.average.toFixed(1)} />
        <StatTile label={t('stats.figures.first9Average')} value={stats.first9Average.toFixed(1)} />
        <StatTile
          label={t('stats.figureWithCount', {
            label: t('stats.figures.checkoutRate'),
            hits: stats.checkoutHits,
            attempts: stats.checkoutAttempts,
          })}
          value={
            stats.checkoutAttempts > 0
              ? formatRate(stats.checkoutHits, stats.checkoutAttempts)
              : '—'
          }
        />
        <StatTile label={t('stats.figures.bestCheckout')} value={`${stats.bestCheckout ?? '—'}`} />
        <StatTile label={t('stats.figures.fewestDarts')} value={`${stats.dartsPerLeg?.best ?? '—'}`} />
        <StatTile
          label={t('stats.figures.averageDarts')}
          value={stats.dartsPerLeg ? stats.dartsPerLeg.average.toFixed(1) : '—'}
        />
      </StatTiles>
      <BandRow bands={bands} />
    </>
  );
};

const styles = StyleSheet.create({
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.accent,
  },
  tileLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  bands: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
  },
  band: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  bandValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  bandLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
