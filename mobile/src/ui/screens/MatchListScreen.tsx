import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { listRecentMatches } from '../../application/services/historyRepository';
import type { RecentMatchSummary } from '../../domain/history/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MatchList'>;

export const formatMatchTime = (createdAt: number) => {
  const date = new Date(createdAt);
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const MatchCard = ({
  match,
  onPress,
}: {
  match: RecentMatchSummary;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.matchCard, pressed && styles.pressed]}
  >
    <View style={styles.matchText}>
      <Text style={styles.matchTitle}>{match.modeLabel ?? match.mode}</Text>
      <Text style={styles.matchMeta}>
        {formatMatchTime(match.createdAt)} · {match.playerCount} 人
      </Text>
    </View>
    <Text style={styles.winner}>🏆 {match.winnerName ?? '—'}</Text>
  </Pressable>
);

// Every saved match, newest first, guests-only matches included.
export const MatchListScreen = ({ navigation }: Props) => {
  const [matches, setMatches] = useState<RecentMatchSummary[] | null>(null);

  // Reload on return, since a match can be deleted from its detail page.
  useFocusEffect(
    useCallback(() => {
      listRecentMatches(null)
        .then(setMatches)
        .catch(() => setMatches([]));
    }, []),
  );

  if (matches === null) {
    return <Text style={styles.empty}>正在读取…</Text>;
  }
  return (
    <FlatList
      data={matches}
      keyExtractor={match => `${match.id}`}
      contentContainerStyle={styles.content}
      ListEmptyComponent={<Text style={styles.empty}>还没有完成的比赛。</Text>}
      renderItem={({ item }) => (
        <MatchCard
          match={item}
          onPress={() =>
            navigation.navigate('MatchDetail', { matchId: item.id })
          }
        />
      )}
    />
  );
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 10,
  },
  empty: {
    padding: 24,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  pressed: {
    backgroundColor: colors.panelStrong,
  },
  matchText: {
    flex: 1,
    gap: 4,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  matchMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  winner: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
});
