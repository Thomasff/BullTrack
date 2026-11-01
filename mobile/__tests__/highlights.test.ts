import {
  beatsPersonalBest,
  detectRoundHighlight,
  highlightName,
  highlightRibbon,
  type HighlightDart,
  type RoundHighlightInput,
} from '../src/domain/share/highlights';

const T = (sector: number): HighlightDart => ({ sector, multiplier: 3 });
const D = (sector: number): HighlightDart => ({ sector, multiplier: 2 });
const S = (sector: number): HighlightDart => ({ sector, multiplier: 1 });
const IB: HighlightDart = { sector: 25, multiplier: 2 };
const OB: HighlightDart = { sector: 25, multiplier: 1 };

const points = (darts: HighlightDart[]) =>
  darts.reduce((sum, dart) => sum + (dart.sector === 25 ? 25 * dart.multiplier : dart.sector * dart.multiplier), 0);

const x01Round = (
  darts: HighlightDart[],
  x01: Partial<NonNullable<RoundHighlightInput['x01']>> = {},
  extra: Partial<RoundHighlightInput> = {},
) =>
  detectRoundHighlight({
    mode: 'game501',
    darts,
    total: points(darts),
    x01: { leftBefore: 501, bust: false, checkout: false, legDarts: null, ...x01 },
    marks: null,
    personalBest: false,
    selfMocking: false,
    ...extra,
  });

const otherRound = (mode: string, darts: HighlightDart[], marks: number | null = null) =>
  detectRoundHighlight({
    mode,
    darts,
    total: points(darts),
    x01: null,
    marks,
    personalBest: false,
    selfMocking: false,
  });

test('X01: 180 beats three in a bed, a bust is no highlight', () => {
  expect(x01Round([T(20), T(20), T(20)])?.kind).toBe('oneEighty');
  expect(x01Round([T(20), T(20), T(20)], { leftBefore: 170, bust: true })).toBeNull();
  expect(x01Round([T(20), T(19), S(20)])?.kind).toBe('tonPlus');
  expect(x01Round([T(20), T(19), S(1)], { bust: true })).toBeNull();
  expect(x01Round([S(20), S(5), S(1)])).toBeNull();
});

test('X01 checkouts: 100+ and the 9 / 12 dart 501', () => {
  const checkout = x01Round([T(20), T(19), D(12)], { leftBefore: 141, checkout: true });
  expect(checkout).toEqual({ kind: 'bigCheckout', value: 141 });
  expect(highlightName(checkout!)).toBe('141 checkout');
  expect(x01Round([D(20)], { leftBefore: 40, checkout: true })).toBeNull();
  expect(x01Round([T(20), T(19), D(12)], { leftBefore: 141, checkout: true, legDarts: 9 })?.kind).toBe('nineDarter');
  expect(x01Round([D(20)], { leftBefore: 40, checkout: true, legDarts: 11 })?.kind).toBe('twelveDarter');
  expect(x01Round([D(20)], { leftBefore: 40, checkout: true, legDarts: 15 })).toBeNull();
});

test('patterns in any mode', () => {
  expect(otherRound('aroundTheClock', [IB, OB, OB])?.kind).toBe('hatTrick');
  expect(otherRound('highScore', [S(7), S(7), S(7)])?.kind).toBe('threeInABed');
  expect(otherRound('highScore', [T(20), T(20), T(20)])?.kind).toBe('oneEighty');
  expect(otherRound('darts99', [T(20), T(20), T(20)])?.kind).toBe('threeInABed');
  expect(otherRound('highScore', [S(7), T(7), D(7)])?.kind).toBe('shanghai');
  expect(otherRound('highScore', [S(7), S(7)])).toBeNull();
  expect(otherRound('highScore', [S(7), T(7), D(8)])).toBeNull();
});

test('cricket: 9 marks, white horse when three different trebles', () => {
  expect(otherRound('cricket', [T(20), T(19), T(18)], 9)?.kind).toBe('whiteHorse');
  expect(otherRound('cricket', [T(20), T(20), T(20)], 9)?.kind).toBe('nineMarks');
  expect(otherRound('cricket', [T(20), T(20), T(2)], 6)).toBeNull();
});

test('personal best and the self-mocking 26', () => {
  expect(x01Round([S(20), S(20), S(19)], {}, { personalBest: true })?.kind).toBe('personalBest');
  expect(x01Round([S(20), S(5), S(1)], {}, { selfMocking: true })?.kind).toBe('bedAndBreakfast');
  expect(otherRound('cricket', [S(20), S(5), S(1)], 1)).toBeNull();
  expect(highlightRibbon({ kind: 'oneEighty', value: 180 })).toBe('ONE HUNDRED AND EIGHTY');
  expect(highlightRibbon({ kind: 'threeInABed', value: 21 })).toBe('THREE IN A BED');
});

test('a best round needs enough earlier matches and a named player', () => {
  const history = { matches: 3, best: 100 };
  expect(beatsPersonalBest('game501', 'Tom', 101, history, 0)).toBe(true);
  expect(beatsPersonalBest('game501', 'Tom', 101, history, 120)).toBe(false);
  expect(beatsPersonalBest('game501', 'Tom', 101, { matches: 2, best: 10 }, 0)).toBe(false);
  expect(beatsPersonalBest('game501', '玩家 1', 101, history, 0)).toBe(false);
  expect(beatsPersonalBest('cricket', 'Tom', 101, history, 0)).toBe(false);
  expect(beatsPersonalBest('game501', 'Tom', 101, undefined, 0)).toBe(false);
});
