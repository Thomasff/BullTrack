import { captureRef } from 'react-native-view-shot';
import { bullTrackNativeBridge } from '../../native-bridge/bulltrack/bullTrackNative';
import { getCurrentThrowerId, useGameStore } from '../stores/gameStore';
import { createGameEngine, isCricketType } from './gameRules';
import { getRoundBests, listMatchStarts } from './historyRepository';
import { buildTeams, getEngineSides, getThrowerId, type TeamInfo } from '../../domain/game/teams';
import { createThrow, getThrowMultiplier, getThrowSector, type ThrowRing } from '../../domain/game/throws';
import type { GameType, PlayerSummary, ThrowResult } from '../../domain/game/types';
import type { MatchDetail } from '../../domain/history/types';
import type { RoundPhotos, RoundShare } from '../../domain/share/shareCards';
import {
  beatsPersonalBest,
  detectRoundHighlight,
  type RoundBest,
} from '../../domain/share/highlights';

const X01_MODES = ['game301', 'game501', 'game701'];

// Modes whose random parts (Killer numbers, Random Cricket targets) come from the game seed,
// which saved matches do not keep: their rounds cannot be replayed through the engine.
const SEEDED_MODES = ['killer', 'randomCricket'];

// Marks a round scores in a cricket mode: darts on the side's targets ('25' is the bull).
const countMarks = (throws: ThrowResult[], targets: string[]) =>
  throws.reduce(
    (sum, item) => sum + (targets.includes(String(getThrowSector(item))) ? getThrowMultiplier(item) : 0),
    0,
  );

interface ReplayGame {
  mode: GameType;
  modeLabel: string | null;
  players: PlayerSummary[];
  teams: TeamInfo[] | null;
  // null for a saved match, which keeps no seed.
  seed: number | null;
  createdAt: number;
}

interface ReplayRound {
  // The person who threw.
  playerId: string;
  roundIndex: number;
  throws: ThrowResult[];
}

export interface HighlightContext {
  // Per player name: earlier matches of this mode and the best round in them.
  bests: Map<string, RoundBest>;
  selfMocking: boolean;
}

export interface ReplayedRound {
  // Round number and thrower name, the same for the live game and its saved match.
  key: string;
  share: RoundShare;
}

export const roundKey = (roundIndex: number, name: string) => `${roundIndex}|${name}`;

const roundTotal = (throws: ThrowResult[]) => throws.reduce((sum, item) => sum + item.score, 0);

// Plays the rounds through the game's rule engine in turn order, so each round's card can say
// what it did (score left, bust, marks) and whether it was a highlight.
const replayRounds = (
  game: ReplayGame,
  rounds: ReplayRound[],
  context: HighlightContext | null,
): ReplayedRound[] => {
  const replayed: ReplayedRound[] = [];
  const seatOf = (playerId: string) => Math.max(0, game.players.findIndex(player => player.id === playerId));
  const solo501 = game.mode === 'game501' && game.teams === null;
  const earlierBest = new Map<string, number>();
  const legDarts = new Map<string, number>();

  const add = (
    round: ReplayRound,
    shown: Pick<RoundShare, 'value' | 'unit' | 'note'>,
    x01: { leftBefore: number; bust: boolean; checkout: boolean } | null,
    marks: number | null,
  ) => {
    const seat = seatOf(round.playerId);
    const name = game.players[seat]?.name ?? '';
    const total = roundTotal(round.throws);
    const darts = (legDarts.get(round.playerId) ?? 0) + round.throws.length;
    legDarts.set(round.playerId, darts);
    const highlight = context
      ? detectRoundHighlight({
          mode: game.mode,
          darts: round.throws.map(item => ({ sector: getThrowSector(item), multiplier: getThrowMultiplier(item) })),
          total,
          x01: x01 ? { ...x01, legDarts: solo501 ? darts : null } : null,
          marks,
          personalBest: beatsPersonalBest(
            game.mode,
            name,
            total,
            context.bests.get(name),
            earlierBest.get(name) ?? 0,
          ),
          selfMocking: context.selfMocking,
        })
      : null;
    earlierBest.set(name, Math.max(earlierBest.get(name) ?? 0, total));
    replayed.push({
      key: roundKey(round.roundIndex, name),
      share: {
        mode: game.mode,
        modeLabel: game.modeLabel,
        playerName: name,
        playerSeat: seat,
        roundNumber: round.roundIndex,
        throws: round.throws,
        ...shown,
        highlight,
        createdAt: game.createdAt,
      },
    });
  };

  if (game.seed === null && SEEDED_MODES.includes(game.mode)) {
    [...rounds]
      .sort((left, right) => left.roundIndex - right.roundIndex || seatOf(left.playerId) - seatOf(right.playerId))
      .forEach(round => add(round, { value: roundTotal(round.throws), unit: 'points', note: null }, null, null));
    return replayed;
  }

  const engine = createGameEngine(game.mode, getEngineSides(game.players, game.teams), game.seed ?? 0);
  // Each person's rounds in the order thrown; the engine says whose turn comes next.
  const queues = new Map<string, ReplayRound[]>();
  rounds.forEach(round => queues.set(round.playerId, [...(queues.get(round.playerId) ?? []), round]));
  for (let step = 0; step < rounds.length; step += 1) {
    const sideId = engine.getCurrentPlayerId();
    const sides = engine.getScoreBoard().players;
    const throwerId = getThrowerId(game.teams, sides, sideId);
    const round = throwerId ? queues.get(throwerId)?.shift() : undefined;
    if (!round) {
      break;
    }
    const before = sides.find(side => side.id === sideId);
    const result = engine.applyRound(round.throws);
    const after = engine.getScoreBoard().players.find(side => side.id === sideId);
    const total = roundTotal(round.throws);

    if (X01_MODES.includes(game.mode)) {
      const checkout = after?.score === 0;
      const bust = !checkout && result.roundScore === 0 && total > 0;
      add(
        round,
        {
          value: total,
          unit: 'points',
          note: checkout ? { kind: 'checkout' } : bust ? { kind: 'bust' } : { kind: 'left', value: after?.score ?? 0 },
        },
        { leftBefore: before?.score ?? 0, bust, checkout },
        null,
      );
    } else if (isCricketType(game.mode)) {
      const marks = countMarks(round.throws, Object.keys(before?.marks ?? {}));
      add(round, { value: marks, unit: 'marks', note: null }, null, marks);
    } else {
      add(round, { value: result.roundScore, unit: 'points', note: null }, null, null);
    }
  }
  return replayed;
};

const liveGame = (): ReplayGame | null => {
  const state = useGameStore.getState();
  if (!state.selectedMode) {
    return null;
  }
  return {
    mode: state.selectedMode,
    modeLabel: state.selectedModeLabel,
    players: state.players,
    teams: state.teams,
    seed: state.gameSeed,
    createdAt: state.gameStartedAt ?? Date.now(),
  };
};

// The round on screen as a share card: the unconfirmed result as it stands now (edited or
// not, never a highlight before it is confirmed), or after the game the winning round.
export const buildCurrentRoundShare = (context: HighlightContext | null = null): RoundShare | null => {
  const state = useGameStore.getState();
  const game = liveGame();
  if (!game) {
    return null;
  }
  if (state.status === 'gameOver') {
    const replayed = replayRounds(game, state.completedRounds, context);
    return replayed[replayed.length - 1]?.share ?? null;
  }
  const throwerId = getCurrentThrowerId(state) ?? state.currentPlayerId;
  if (state.currentThrows.length === 0 || !throwerId) {
    return null;
  }
  const current = { playerId: throwerId, roundIndex: state.currentRoundNumber, throws: state.currentThrows };
  const replayed = replayRounds(game, [...state.completedRounds, current], null);
  return replayed[replayed.length - 1]?.share ?? null;
};

// Every confirmed round of the game being played that was a highlight, in the order thrown.
export const listGameHighlights = (context: HighlightContext): ReplayedRound[] => {
  const game = liveGame();
  if (!game) {
    return [];
  }
  return replayRounds(game, useGameStore.getState().completedRounds, context).filter(
    round => round.share.highlight !== null,
  );
};

// Per player name: matches of the mode started before `before`, and the best round in them.
export const loadRoundBests = (mode: string, names: string[], before: number) =>
  getRoundBests(mode, names, before).catch(() => new Map<string, RoundBest>());

const savedRing = (target: string, multiplier: number): ThrowRing => {
  if (target === 'IB') {
    return 'innerBull';
  }
  if (target === 'OB') {
    return 'outerBull';
  }
  if (target === 'miss' || multiplier === 0) {
    return 'miss';
  }
  return multiplier === 3 ? 'triple' : multiplier === 2 ? 'double' : 'single';
};

// Every round of a saved match as a share card, with its highlight.
export const replayMatchDetail = async (detail: MatchDetail, selfMocking: boolean): Promise<ReplayedRound[]> => {
  const players: PlayerSummary[] = detail.players.map(player => ({
    id: String(player.playerId),
    name: player.name,
    score: 0,
    roundScores: [],
    ...(player.teamIndex !== null ? { teamIndex: player.teamIndex } : {}),
  }));
  const bests = await loadRoundBests(
    detail.mode,
    players.map(player => player.name),
    detail.createdAt,
  );
  const rounds = detail.rounds.map(round => ({
    playerId: String(round.playerId),
    roundIndex: round.roundIndex,
    throws: round.throws.map((dart, index) => {
      const item = createThrow(savedRing(dart.target, dart.multiplier), Number(dart.target) || 0, `saved-${index}`);
      return dart.point ? { ...item, pointNorm: dart.point } : item;
    }),
  }));
  try {
    return replayRounds(
      {
        mode: detail.mode as GameType,
        modeLabel: detail.modeLabel,
        players,
        teams: buildTeams(players),
        seed: null,
        createdAt: detail.createdAt,
      },
      rounds,
      { bests, selfMocking },
    );
  } catch {
    return [];
  }
};

// File name stem of a highlight's photos: the game's start (its saved match's createdAt), the
// round and the thrower's seat.
export const roundPhotoName = (createdAt: number, roundNumber: number, seat: number) =>
  `${createdAt}-${roundNumber}-${seat}`;

const photoFiles = (name: string) => [`${name}-full.jpg`, `${name}-close.jpg`];
const photoStart = (fileName: string) => Number(fileName.split('-')[0]);

// A confirmed round keeps its photo when it was a highlight; a retried round that no longer is
// one loses the photo it had.
export const keepConfirmedRoundPhoto = async (name: string, highlight: boolean) => {
  if (highlight) {
    await bullTrackNativeBridge.saveRoundPhotos('highlight', name);
  } else {
    await bullTrackNativeBridge.deleteRoundPhotos(photoFiles(name));
  }
};

// Photos of the round on screen for its share card, kept in the cache; null without a photo.
export const saveCurrentRoundPhotos = async (): Promise<RoundPhotos | null> => {
  const files = await bullTrackNativeBridge.saveRoundPhotos('current', `current-${Date.now()}`);
  return files.full ? { full: files.full, close: files.close ?? null } : null;
};

// The kept highlight photos by name stem.
export const loadRoundPhotos = async (): Promise<Map<string, RoundPhotos>> => {
  const { directory, names } = await bullTrackNativeBridge.listRoundPhotos();
  const photos = new Map<string, RoundPhotos>();
  names
    .filter(name => name.endsWith('-full.jpg'))
    .forEach(name => {
      const stem = name.slice(0, -'-full.jpg'.length);
      const close = `${stem}-close.jpg`;
      photos.set(stem, {
        full: directory + name,
        close: names.includes(close) ? directory + close : null,
      });
    });
  return photos;
};

const MAX_PHOTO_MATCHES = 5;

// Keeps the photos of the five newest saved matches that have any; drops older ones and those of
// games left before the end. Run once a game is saved, so no game is being played.
export const pruneRoundPhotos = async () => {
  const [{ names }, starts] = await Promise.all([bullTrackNativeBridge.listRoundPhotos(), listMatchStarts()]);
  const saved = new Set(starts);
  const kept = new Set(
    [...new Set(names.map(photoStart))]
      .filter(start => saved.has(start))
      .sort((left, right) => right - left)
      .slice(0, MAX_PHOTO_MATCHES),
  );
  const stale = names.filter(name => !kept.has(photoStart(name)));
  if (stale.length > 0) {
    await bullTrackNativeBridge.deleteRoundPhotos(stale);
  }
};

// Drops the photos of the match started at createdAt, or every photo when it is left out.
export const deleteMatchPhotos = async (createdAt?: number) => {
  const { names } = await bullTrackNativeBridge.listRoundPhotos();
  const doomed = createdAt === undefined ? names : names.filter(name => photoStart(name) === createdAt);
  if (doomed.length > 0) {
    await bullTrackNativeBridge.deleteRoundPhotos(doomed);
  }
};

// Captures the card view as a PNG at the card's pixel size.
export const captureCard = (view: Parameters<typeof captureRef>[0], width: number, height: number) =>
  captureRef(view, { format: 'png', result: 'tmpfile', width, height });

export const shareCardImage = (uri: string, fileName: string, caption: string) =>
  bullTrackNativeBridge.shareImage(uri, fileName, caption);

export const saveCardImage = (uri: string, fileName: string) =>
  bullTrackNativeBridge.saveImageToGallery(uri, fileName);
