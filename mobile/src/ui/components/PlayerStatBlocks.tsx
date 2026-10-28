import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { PlayerX01Stats } from '../../domain/history/types';

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

// X01 tiles plus a row counting rounds per score band.
export const X01StatBlock = ({ stats }: { stats: PlayerX01Stats }) => {
  const bands = [
    { label: '60–99', count: stats.count60 },
    { label: '100–139', count: stats.count100 },
    { label: '140–179', count: stats.count140 },
    { label: '180', count: stats.count180 },
  ];
  return (
    <>
      <StatTiles>
        <StatTile label="三镖均分" value={stats.average.toFixed(1)} />
        <StatTile label="前 9 镖均分" value={stats.first9Average.toFixed(1)} />
        <StatTile
          label={`收镖成功率（${stats.checkoutHits}/${stats.checkoutAttempts}）`}
          value={
            stats.checkoutAttempts > 0
              ? formatRate(stats.checkoutHits, stats.checkoutAttempts)
              : '—'
          }
        />
        <StatTile label="最高收镖" value={`${stats.bestCheckout ?? '—'}`} />
      </StatTiles>
      <View style={styles.bands}>
        {bands.map(band => (
          <View key={band.label} style={styles.band}>
            <Text style={styles.bandValue}>{band.count}</Text>
            <Text style={styles.bandLabel}>{band.label}</Text>
          </View>
        ))}
      </View>
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
