import { pickRoundPhoto, playerLabel, shareFileName, summarizeMatch, winnerLine } from '../src/domain/share/shareCards';
import { createThrow } from '../src/domain/game/throws';
import type { MatchDetail } from '../src/domain/history/types';

const dart = (score: number, multiplier: number, target: string, dartIndex = 0) => ({
  dartIndex,
  score,
  multiplier,
  target,
});

const x01Match: MatchDetail = {
  id: 1,
  mode: 'game301',
  modeLabel: '301',
  createdAt: new Date(2026, 9, 31, 20, 0).getTime(),
  players: [
    { playerId: 1, name: 'Tom', seatIndex: 0, isWinner: true, teamIndex: null, finalScore: 0 },
    { playerId: 2, name: '玩家 2', seatIndex: 1, isWinner: false, teamIndex: null, finalScore: 241 },
  ],
  rounds: [
    { playerId: 1, roundIndex: 1, throws: [dart(60, 3, '20'), dart(60, 3, '20'), dart(60, 3, '20')] },
    { playerId: 2, roundIndex: 1, throws: [dart(20, 1, '20'), dart(20, 1, '20'), dart(20, 1, '20')] },
    // 121 left: 125 is a bust and counts as 0.
    { playerId: 1, roundIndex: 2, throws: [dart(60, 3, '20'), dart(60, 3, '20'), dart(5, 1, '5')] },
    { playerId: 2, roundIndex: 2, throws: [dart(0, 0, 'miss')] },
    { playerId: 1, roundIndex: 3, throws: [dart(60, 3, '20'), dart(25, 1, 'OB'), dart(36, 2, '18')] },
  ],
};

test('X01 match: busts count as 0 and the winner shows the checkout', () => {
  const share = summarizeMatch(x01Match, { language: 'en', showNames: true });
  const tom = share.sides[0];
  expect(tom.stats).toEqual([
    { label: '3-dart avg', value: (301 / 9 * 3).toFixed(1) },
    { label: 'Checkout', value: '121' },
    { label: 'Darts', value: '9' },
    { label: 'Best round', value: '180' },
  ]);
  expect(tom.trend).toEqual([121, 121, 0]);
  expect(share.trendStart).toBe(301);
  // X01 keeps no final score worth showing.
  expect(tom.finalScore).toBeNull();
  expect(share.sides[1].name).toBe('Player 2');
  expect(winnerLine(share, 'en')).toBe('Tom wins');
});

test('hidden names use the seat number in both languages', () => {
  expect(playerLabel('Tom', 0, false, 'zh')).toBe('玩家 1');
  expect(playerLabel('Tom', 2, false, 'en')).toBe('Player 3');
  expect(playerLabel('玩家 2', 1, true, 'zh')).toBe('玩家 2');
});

test('file names carry the card kind and the date', () => {
  expect(shareFileName('match', x01Match.createdAt)).toBe('BullTrack-match-2026-10-31.png');
});

test('the automatic photo choice takes the close-up for a group', () => {
  const photos = { full: 'full.jpg', close: 'close.jpg' };
  const t20 = (id: string, x: number) => ({ ...createThrow('triple', 20, id), pointNorm: { x, y: -0.53 } });
  const grouped = [t20('a', 0), t20('b', 0.03), t20('c', -0.03)];
  expect(pickRoundPhoto(photos, 'auto', grouped)).toEqual({ uri: 'close.jpg', kind: 'close' });
  const spread = [t20('a', 0), createThrow('double', 3, 'b'), createThrow('miss', 0, 'c')];
  expect(pickRoundPhoto(photos, 'auto', spread)).toEqual({ uri: 'full.jpg', kind: 'full' });
  expect(pickRoundPhoto({ full: 'full.jpg', close: null }, 'close', grouped)?.kind).toBe('full');
  expect(pickRoundPhoto(photos, 'none', grouped)).toBeNull();
  expect(pickRoundPhoto(null, 'auto', grouped)).toBeNull();
});
