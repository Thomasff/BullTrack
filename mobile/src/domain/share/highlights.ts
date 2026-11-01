import { isDefaultPlayerName } from '../game/players';

// Highlight kinds, best first: a round that is several of them shows the first one.
export type HighlightKind =
  | 'nineDarter'
  | 'twelveDarter'
  | 'oneEighty'
  | 'bigCheckout'
  | 'hatTrick'
  | 'whiteHorse'
  | 'nineMarks'
  | 'threeInABed'
  | 'shanghai'
  | 'tonPlus'
  | 'personalBest'
  | 'bedAndBreakfast';

export interface Highlight {
  kind: HighlightKind;
  // The round total, used by the checkout name ("121 checkout").
  value: number;
}

// One dart as the rules see it: sector 1-20, 25 for either bull, 0 for a miss;
// multiplier 1-3 (the inner bull is 2, a miss 0).
export interface HighlightDart {
  sector: number;
  multiplier: number;
}

export interface RoundHighlightInput {
  mode: string;
  darts: HighlightDart[];
  // Points the darts scored, busts included.
  total: number;
  // X01 only: score left before the round, whether it bust or checked out, and in a solo
  // 501 the darts the player used over the whole leg up to the end of this round.
  x01: { leftBefore: number; bust: boolean; checkout: boolean; legDarts: number | null } | null;
  // Cricket modes: marks the round scored on the side's targets; null elsewhere.
  marks: number | null;
  personalBest: boolean;
  selfMocking: boolean;
}

const X01_MODES = ['game301', 'game501', 'game701'];

// Modes whose round total is the round's score, where a best round means something.
const BEST_ROUND_MODES = [...X01_MODES, 'highScore'];

// A player needs this many earlier matches of the mode before a best round counts.
export const PERSONAL_BEST_MIN_MATCHES = 3;

export interface RoundBest {
  // Earlier matches of the mode the player threw in, and their highest round total.
  matches: number;
  best: number;
}

// A round beats the player's best when they have played the mode enough before and it tops
// both their history and their earlier rounds of this game.
export const beatsPersonalBest = (
  mode: string,
  name: string,
  total: number,
  history: RoundBest | undefined,
  earlierBest: number,
) =>
  BEST_ROUND_MODES.includes(mode) &&
  !isDefaultPlayerName(name) &&
  history !== undefined &&
  history.matches >= PERSONAL_BEST_MIN_MATCHES &&
  total > history.best &&
  total > earlierBest;

export const detectRoundHighlight = (input: RoundHighlightInput): Highlight | null => {
  const { darts, total, x01, marks } = input;
  // A bust scores nothing, whatever the darts hit.
  if (x01?.bust) {
    return null;
  }
  const found = (kind: HighlightKind): Highlight => ({ kind, value: total });
  const three = darts.length === 3;
  const sameSector = three && darts.every(dart => dart.sector === darts[0].sector);
  const numbered = darts.every(dart => dart.sector >= 1 && dart.sector <= 20);

  if (x01?.checkout && input.mode === 'game501' && x01.legDarts !== null) {
    if (x01.legDarts <= 9) {
      return found('nineDarter');
    }
    if (x01.legDarts <= 12) {
      return found('twelveDarter');
    }
  }
  if ((x01 || input.mode === 'highScore') && total === 180) {
    return found('oneEighty');
  }
  if (x01?.checkout && x01.leftBefore >= 100) {
    return found('bigCheckout');
  }
  if (three && darts.every(dart => dart.sector === 25)) {
    return found('hatTrick');
  }
  if (marks === 9) {
    const sectors = new Set(darts.map(dart => dart.sector));
    return found(sectors.size === 3 && darts.every(dart => dart.multiplier === 3) ? 'whiteHorse' : 'nineMarks');
  }
  if (sameSector && numbered && darts.every(dart => dart.multiplier === darts[0].multiplier)) {
    return found('threeInABed');
  }
  if (
    sameSector &&
    numbered &&
    [1, 2, 3].every(multiplier => darts.some(dart => dart.multiplier === multiplier))
  ) {
    return found('shanghai');
  }
  if (x01 && total >= 100) {
    return found('tonPlus');
  }
  if (input.personalBest) {
    return found('personalBest');
  }
  if (
    input.selfMocking &&
    (x01 !== null || input.mode === 'highScore') &&
    three &&
    darts.every(dart => dart.multiplier === 1) &&
    [1, 5, 20].every(sector => darts.some(dart => dart.sector === sector))
  ) {
    return found('bedAndBreakfast');
  }
  return null;
};

const NAMES: Record<HighlightKind, string> = {
  nineDarter: 'Nine-darter',
  twelveDarter: '12-dart leg',
  oneEighty: '180',
  bigCheckout: 'checkout',
  hatTrick: 'Hat trick',
  whiteHorse: 'White horse',
  nineMarks: '9 marks',
  threeInABed: 'Three in a bed',
  shanghai: 'Shanghai',
  tonPlus: 'Ton+',
  personalBest: 'Personal best',
  bedAndBreakfast: 'Bed and breakfast',
};

// Short name for labels and chips, in English on every screen ("Hat trick", "121 checkout").
export const highlightName = (highlight: Highlight) =>
  highlight.kind === 'bigCheckout' ? `${highlight.value} checkout` : NAMES[highlight.kind];

// The red ribbon on a card.
export const highlightRibbon = (highlight: Highlight) =>
  highlight.kind === 'oneEighty' ? 'ONE HUNDRED AND EIGHTY' : highlightName(highlight).toUpperCase();
