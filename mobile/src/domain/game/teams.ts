import type { PlayerSummary } from './types';

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const MAX_TEAM_SIZE = 4;
export const MAX_TEAM_PLAYERS = 8;

// A team plays as one side: the rule engines see it as a single player with one shared score.
export interface TeamInfo {
  id: string;
  index: number;
  name: string;
  // In setup order; members take turns each time the team throws.
  memberIds: string[];
}

export const getTeamName = (index: number) => `${String.fromCharCode(65 + index)} 队`;

// Groups players into teams by teamIndex; null when the game is not a team game.
export const buildTeams = (players: PlayerSummary[]): TeamInfo[] | null => {
  if (!players.some(player => player.teamIndex !== undefined)) {
    return null;
  }
  const indexes = [...new Set(players.map(player => player.teamIndex ?? 0))].sort(
    (left, right) => left - right,
  );
  return indexes.map(index => ({
    id: `team-${index + 1}`,
    index,
    name: getTeamName(index),
    memberIds: players
      .filter(player => (player.teamIndex ?? 0) === index)
      .map(player => player.id),
  }));
};

// What the rule engine plays with: the teams in a team game, otherwise the players.
export const getEngineSides = (
  players: PlayerSummary[],
  teams: TeamInfo[] | null,
): PlayerSummary[] =>
  teams
    ? teams.map(team => ({ id: team.id, name: team.name, score: 0, roundScores: [] }))
    : players;

// The person throwing the given side's next round. Every engine records one round score
// per round a side plays, so that count says whose turn it is inside the team.
export const getThrowerId = (
  teams: TeamInfo[] | null,
  sides: PlayerSummary[],
  sideId: string | null,
): string | null => {
  const team = teams?.find(item => item.id === sideId);
  if (!team) {
    return sideId;
  }
  const roundsPlayed = sides.find(side => side.id === sideId)?.roundScores.length ?? 0;
  return team.memberIds[roundsPlayed % team.memberIds.length] ?? null;
};
