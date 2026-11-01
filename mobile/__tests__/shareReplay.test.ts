import { replayMatchDetail } from '../src/application/services/shareService';
import type { MatchDetail } from '../src/domain/history/types';

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('../src/application/services/historyRepository', () => ({
  getRoundBests: jest.fn(async () => new Map()),
}));

const dart = (score: number, multiplier: number, target: string, dartIndex = 0) => ({
  dartIndex,
  score,
  multiplier,
  target,
});

test('a saved match replays in turn order with its highlights', async () => {
  // Saved rows come back by round, then player id: Amy (id 1) sits second but sorts first.
  const detail: MatchDetail = {
    id: 1,
    mode: 'game301',
    modeLabel: '301',
    createdAt: 0,
    players: [
      { playerId: 2, name: 'Tom', seatIndex: 0, isWinner: true, teamIndex: null, finalScore: 0 },
      { playerId: 1, name: 'Amy', seatIndex: 1, isWinner: false, teamIndex: null, finalScore: 280 },
    ],
    rounds: [
      { playerId: 1, roundIndex: 1, throws: [dart(7, 1, '7'), dart(7, 1, '7'), dart(7, 1, '7')] },
      { playerId: 2, roundIndex: 1, throws: [dart(60, 3, '20'), dart(60, 3, '20'), dart(60, 3, '20')] },
      { playerId: 2, roundIndex: 2, throws: [dart(60, 3, '20'), dart(36, 2, '18'), dart(25, 1, 'OB')] },
    ],
  };
  const rounds = await replayMatchDetail(detail, false);
  expect(rounds.map(round => round.key)).toEqual(['1|Tom', '1|Amy', '2|Tom']);
  expect(rounds.map(round => round.share.highlight?.kind ?? null)).toEqual([
    'oneEighty',
    'threeInABed',
    null,
  ]);
  // 121 left with 25 last is no double: the third round busts.
  expect(rounds[2].share.note).toEqual({ kind: 'bust' });
  expect(rounds[0].share.note).toEqual({ kind: 'left', value: 121 });
});
