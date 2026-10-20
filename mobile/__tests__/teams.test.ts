import { buildTeams, getEngineSides, getThrowerId, getTeamName } from '../src/domain/game/teams';
import type { PlayerSummary } from '../src/domain/game/types';

const person = (id: string, teamIndex?: number): PlayerSummary => ({
  id,
  name: id,
  score: 0,
  roundScores: [],
  ...(teamIndex === undefined ? {} : { teamIndex }),
});

test('solo games have no teams and play the players themselves', () => {
  const players = [person('p1'), person('p2')];
  expect(buildTeams(players)).toBeNull();
  expect(getEngineSides(players, null)).toBe(players);
  expect(getThrowerId(null, players, 'p2')).toBe('p2');
});

test('teams keep setup order and rotate members per team round', () => {
  const players = [person('p1', 0), person('p2', 0), person('p3', 1)];
  const teams = buildTeams(players);
  expect(teams?.map(team => [team.id, team.name, team.memberIds])).toEqual([
    ['team-1', getTeamName(0), ['p1', 'p2']],
    ['team-2', getTeamName(1), ['p3']],
  ]);
  expect(getTeamName(1)).toBe('B 队');

  const sides = getEngineSides(players, teams);
  expect(sides.map(side => side.id)).toEqual(['team-1', 'team-2']);
  expect(getThrowerId(teams, sides, 'team-1')).toBe('p1');
  sides[0].roundScores = [60];
  expect(getThrowerId(teams, sides, 'team-1')).toBe('p2');
  sides[0].roundScores = [60, 45];
  expect(getThrowerId(teams, sides, 'team-1')).toBe('p1');
  sides[1].roundScores = [3, 3, 3];
  expect(getThrowerId(teams, sides, 'team-2')).toBe('p3');
});
