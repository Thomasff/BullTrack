import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Panel } from '../components/Panel';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, teamColors } from '../theme/colors';
import type { RootStackParamList } from '../../app/navigation/types';
import { startGameSession } from '../../application/services/liveRoundService';
import { listKnownPlayerNames } from '../../application/services/historyRepository';
import { getModeOption, getModeOptionTitle } from '../../domain/game/modeCatalog';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  findDuplicatePlayerName,
  getDefaultPlayerName,
  resolvePlayerNames,
} from '../../domain/game/players';
import {
  MAX_TEAMS,
  MAX_TEAM_PLAYERS,
  MAX_TEAM_SIZE,
  MIN_TEAMS,
  getTeamName,
} from '../../domain/game/teams';

type Props = NativeStackScreenProps<RootStackParamList, 'PlayerSetup'>;

// A seat in the lineup: the team (always 0 when playing alone) and its position in that team.
interface SeatRef {
  team: number;
  index: number;
}

export const PlayerSetupScreen = ({ navigation, route }: Props) => {
  const { t } = useTranslation();
  const [teamMode, setTeamMode] = useState(false);
  // Solo: one group of names. Team game: one group per team, in A/B/C/D order.
  const [soloNames, setSoloNames] = useState<string[]>(() =>
    Array.from({ length: getModeOption(route.params.modeOptionId)?.minSides ?? 1 }, () => ''),
  );
  const [teamNames, setTeamNames] = useState<string[][]>([[''], ['']]);
  const [active, setActive] = useState<SeatRef>({ team: 0, index: 0 });
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const selectedOption = useMemo(
    () => getModeOption(route.params.modeOptionId),
    [route.params.modeOptionId],
  );

  useEffect(() => {
    listKnownPlayerNames()
      .then(setKnownNames)
      .catch(() => setKnownNames([]));
  }, []);

  const groups = teamMode ? teamNames : [soloNames];
  const setGroups = (update: (current: string[][]) => string[][]) => {
    if (teamMode) {
      setTeamNames(update);
    } else {
      setSoloNames(current => update([current])[0]);
    }
  };
  const flatNames = groups.flat();
  const maxPlayers = teamMode ? MAX_TEAM_PLAYERS : MAX_PLAYERS;
  const maxGroupSize = teamMode ? MAX_TEAM_SIZE : MAX_PLAYERS;
  const minGroupSize = teamMode ? 1 : MIN_PLAYERS;
  const resolvedNames = resolvePlayerNames(flatNames);
  const duplicateName = findDuplicatePlayerName(flatNames);
  // Team games always have at least two teams; only solo games can be short of sides.
  const minSides = selectedOption?.minSides ?? 1;
  const tooFewSides = !teamMode && soloNames.length < minSides;
  const suggestions = knownNames.filter(name => !resolvedNames.includes(name));
  // Default names number the seats across all teams, matching resolvePlayerNames.
  const flatIndexOf = (seat: SeatRef) =>
    groups.slice(0, seat.team).reduce((sum, group) => sum + group.length, 0) + seat.index;

  const switchMode = (nextTeamMode: boolean) => {
    setTeamMode(nextTeamMode);
    setActive({ team: 0, index: 0 });
  };

  const updateName = (seat: SeatRef, value: string) => {
    setGroups(current =>
      current.map((group, team) =>
        team === seat.team ? group.map((name, i) => (i === seat.index ? value : name)) : group,
      ),
    );
  };

  const addPlayer = (team: number, name = '') => {
    if (flatNames.length >= maxPlayers || groups[team].length >= maxGroupSize) {
      return false;
    }
    setGroups(current =>
      current.map((group, i) => (i === team ? [...group, name] : group)),
    );
    setActive({ team, index: groups[team].length });
    return true;
  };

  const removePlayer = (seat: SeatRef) => {
    if (groups[seat.team].length > minGroupSize) {
      setGroups(current =>
        current.map((group, team) =>
          team === seat.team ? group.filter((_, i) => i !== seat.index) : group,
        ),
      );
      setActive({ team: 0, index: 0 });
    }
  };

  const addTeam = () => {
    if (teamNames.length < MAX_TEAMS && flatNames.length < maxPlayers) {
      setTeamNames(current => [...current, ['']]);
      setActive({ team: teamNames.length, index: 0 });
    }
  };

  const removeTeam = (team: number) => {
    if (teamNames.length > MIN_TEAMS) {
      setTeamNames(current => current.filter((_, i) => i !== team));
      setActive({ team: 0, index: 0 });
    }
  };

  // Fills the focused seat, or the first empty one, or adds a seat (to the focused team).
  const pickKnownName = (name: string) => {
    if (groups[active.team]?.[active.index]?.trim() === '') {
      updateName(active, name);
      return;
    }
    for (let team = 0; team < groups.length; team += 1) {
      const index = groups[team].findIndex(item => item.trim() === '');
      if (index >= 0) {
        updateName({ team, index }, name);
        return;
      }
    }
    addPlayer(Math.min(active.team, groups.length - 1), name);
  };

  const startGame = () => {
    if (!selectedOption) {
      return;
    }
    startGameSession(
      selectedOption.runtimeGameType,
      resolvedNames,
      getModeOptionTitle(selectedOption),
      teamMode ? groups.flatMap((group, team) => group.map(() => team)) : undefined,
    );
    navigation.navigate('Game');
  };

  const renderSeat = (name: string, seat: SeatRef, group: string[]) => {
    const isActive = active.team === seat.team && active.index === seat.index;
    return (
      <View key={seat.index} style={styles.playerRow}>
        <Text style={styles.seat}>{seat.index + 1}</Text>
        <TextInput
          value={name}
          onChangeText={value => updateName(seat, value)}
          onFocus={() => setActive(seat)}
          placeholder={getDefaultPlayerName(flatIndexOf(seat))}
          placeholderTextColor={colors.textSecondary}
          maxLength={16}
          style={[styles.input, isActive && styles.inputActive]}
        />
        {group.length > minGroupSize ? (
          <Pressable hitSlop={8} onPress={() => removePlayer(seat)} style={styles.removeButton}>
            <Text style={styles.removeLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderAddPlayer = (team: number, label: string) =>
    flatNames.length < maxPlayers && groups[team].length < maxGroupSize ? (
      <Pressable onPress={() => addPlayer(team)} style={styles.addButton}>
        <Text style={styles.addLabel}>{label}</Text>
      </Pressable>
    ) : null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}>
      <View style={styles.modeSwitch}>
        {([false, true] as const).map(option => (
          <Pressable
            key={option ? 'team' : 'solo'}
            onPress={() => switchMode(option)}
            style={[styles.modeOption, teamMode === option && styles.modeOptionActive]}>
            <Text style={[styles.modeLabel, teamMode === option && styles.modeLabelActive]}>
              {option ? t('setup.team') : t('setup.solo')}
            </Text>
          </Pressable>
        ))}
      </View>

      {teamMode ? (
        <>
          <Text style={styles.hint}>
            {t('setup.teamHint', { players: flatNames.length, max: MAX_TEAM_PLAYERS })}
          </Text>
          {teamNames.map((group, team) => (
            <Panel key={team}>
              <View style={styles.rowBetween}>
                <View style={styles.teamTitleRow}>
                  <View
                    style={[styles.teamDot, { backgroundColor: teamColors[team % teamColors.length] }]}
                  />
                  <Text style={styles.panelTitle}>{getTeamName(team)}</Text>
                </View>
                {teamNames.length > MIN_TEAMS ? (
                  <Pressable hitSlop={8} onPress={() => removeTeam(team)}>
                    <Text style={styles.removeTeamLabel}>{t('setup.removeTeam')}</Text>
                  </Pressable>
                ) : null}
              </View>
              {group.map((name, index) => renderSeat(name, { team, index }, group))}
              {renderAddPlayer(team, t('setup.addMember'))}
            </Panel>
          ))}
          {teamNames.length < MAX_TEAMS && flatNames.length < MAX_TEAM_PLAYERS ? (
            <Pressable onPress={addTeam} style={styles.addButton}>
              <Text style={styles.addLabel}>{t('setup.addTeam')}</Text>
            </Pressable>
          ) : null}
          {duplicateName ? (
            <Text style={styles.error}>{t('setup.duplicateName', { name: duplicateName })}</Text>
          ) : null}
        </>
      ) : (
        <Panel>
          <View style={styles.rowBetween}>
            <Text style={styles.panelTitle}>{t('setup.players')}</Text>
            <Text style={styles.hint}>
              {soloNames.length} / {MAX_PLAYERS}
            </Text>
          </View>
          {soloNames.map((name, index) => renderSeat(name, { team: 0, index }, soloNames))}
          {renderAddPlayer(0, t('setup.addPlayer'))}
          {duplicateName ? (
            <Text style={styles.error}>{t('setup.duplicateName', { name: duplicateName })}</Text>
          ) : null}
          {tooFewSides ? (
            <Text style={styles.hint}>{t('setup.minPlayers', { min: minSides })}</Text>
          ) : null}
        </Panel>
      )}

      {suggestions.length > 0 ? (
        <Panel>
          <Text style={styles.panelTitle}>{t('setup.knownPlayers')}</Text>
          <View style={styles.chips}>
            {suggestions.map(name => (
              <Pressable
                key={name}
                onPress={() => pickKnownName(name)}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
                <Text style={styles.chipLabel}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </Panel>
      ) : null}

      <PrimaryButton
        label={t('setup.start')}
        onPress={startGame}
        disabled={!selectedOption || duplicateName !== null || tooFewSides}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeSwitch: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.panelStrong,
  },
  modeOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeOptionActive: {
    backgroundColor: colors.panel,
  },
  modeLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  modeLabelActive: {
    color: colors.accent,
  },
  teamTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  removeTeamLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  hint: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seat: {
    width: 20,
    fontSize: 16,
    fontWeight: '800',
    color: colors.accent,
    textAlign: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputActive: {
    borderColor: colors.accent,
  },
  removeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLabel: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  addButton: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  addLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
  },
  error: {
    fontSize: 14,
    color: colors.danger,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.panelStrong,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    fontSize: 15,
    color: colors.textPrimary,
  },
});
