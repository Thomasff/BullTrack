import SQLite, {
  type ResultSet,
  type SQLiteDatabase,
  type Transaction,
} from 'react-native-sqlite-storage';
import type {
  CompletedMatchInput,
  MatchDetail,
  MatchDetailRound,
  PlayerDetail,
  PlayerModeStats,
  PlayerSegmentCount,
  PlayerStats,
  PlayerX01Stats,
  RecentMatchSummary,
} from '../../domain/history/types';
import type { BoardPoint } from '../../domain/game/boardGeometry';
import type { ThrowResult } from '../../domain/game/types';
import { getDefaultPlayerName, isDefaultPlayerName } from '../../domain/game/players';
import {
  AROUND_THE_CLOCK_TARGETS,
  CHECKOUT_DRILLS,
  DARTS_99_TARGET,
  getAroundTheClockTarget,
  getRoundTarget,
  type CheckoutDrillType,
  type HalfItTarget,
  type TargetRoundsType,
} from './gameRules';

SQLite.DEBUG(false);
SQLite.enablePromise(true);

const DATABASE_NAME = 'bulltrack_history.db';
// All schema statements are idempotent, so older versions simply re-run them.
const SCHEMA_VERSION = 6;

let databasePromise: Promise<SQLiteDatabase> | null = null;

const getDatabase = async () => {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabase({
      name: DATABASE_NAME,
      location: 'default',
    }).then(async database => {
      await initializeDatabase(database);
      return database;
    });
  }
  return databasePromise;
};

const execute = async (
  database: SQLiteDatabase,
  sql: string,
  params: Array<string | number | null> = [],
) => {
  const [result] = await database.executeSql(sql, params);
  return result;
};

const initializeDatabase = async (database: SQLiteDatabase) => {
  await execute(database, 'PRAGMA foreign_keys = ON');

  const versionResult = await execute(database, 'PRAGMA user_version');
  const currentVersion = Number(versionResult.rows.item(0).user_version ?? 0);
  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }

  await execute(
    database,
    `CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0
    )`,
  );
  await execute(
    database,
    `CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      mode_label TEXT,
      created_at INTEGER NOT NULL,
      winner_player_id INTEGER,
      FOREIGN KEY(winner_player_id) REFERENCES players(id)
    )`,
  );
  await execute(
    database,
    `CREATE TABLE IF NOT EXISTS match_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      seat_index INTEGER NOT NULL,
      is_winner INTEGER NOT NULL DEFAULT 0,
      team_index INTEGER,
      final_score INTEGER,
      FOREIGN KEY(match_id) REFERENCES matches(id),
      FOREIGN KEY(player_id) REFERENCES players(id),
      UNIQUE(match_id, player_id)
    )`,
  );
  await execute(
    database,
    `CREATE TABLE IF NOT EXISTS throws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      round_index INTEGER NOT NULL,
      dart_index INTEGER NOT NULL,
      score INTEGER,
      multiplier INTEGER,
      target TEXT,
      is_hit INTEGER,
      created_at INTEGER NOT NULL,
      point_x REAL,
      point_y REAL,
      FOREIGN KEY(match_id) REFERENCES matches(id),
      FOREIGN KEY(player_id) REFERENCES players(id),
      UNIQUE(match_id, player_id, round_index, dart_index)
    )`,
  );
  // Schema v2: small key-value store for app settings.
  await execute(
    database,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );
  // Columns added after v2. Fresh installs get them from CREATE TABLE above.
  const addColumnIfMissing = async (table: string, column: string, definition: string) => {
    const columns = await execute(database, `PRAGMA table_info(${table})`);
    const exists = Array.from(
      { length: columns.rows.length },
      (_, index) => columns.rows.item(index).name,
    ).includes(column);
    if (!exists) {
      await execute(database, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  // Schema v3: team games.
  await addColumnIfMissing('match_players', 'team_index', 'INTEGER');
  // Schema v4: a deleted player is only hidden, so the matches they played stay intact.
  await addColumnIfMissing('players', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
  // Schema v5: final score for best results; matches saved before stay null.
  await addColumnIfMissing('match_players', 'final_score', 'INTEGER');
  // Schema v6: where a detected dart landed on the board; null when unknown.
  await addColumnIfMissing('throws', 'point_x', 'REAL');
  await addColumnIfMissing('throws', 'point_y', 'REAL');
  await execute(
    database,
    'CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at)',
  );
  await execute(
    database,
    'CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON match_players(match_id)',
  );
  await execute(
    database,
    'CREATE INDEX IF NOT EXISTS idx_throws_match_player_round ON throws(match_id, player_id, round_index)',
  );
  await execute(database, `PRAGMA user_version = ${SCHEMA_VERSION}`);
};

const executeTransactionSql = (
  transaction: Transaction,
  sql: string,
  params: Array<string | number | null>,
  onSuccess?: (result: ResultSet) => void,
) => {
  transaction.executeSql(
    sql,
    params,
    (_transaction, result) => {
      onSuccess?.(result);
    },
    () => true,
  );
};

const getMultiplier = (throwResult: ThrowResult) => {
  switch (throwResult.ring) {
    case 'triple':
      return 3;
    case 'double':
    case 'innerBull':
      return 2;
    case 'miss':
      return 0;
    default:
      return 1;
  }
};

const getTarget = (throwResult: ThrowResult) => {
  if (throwResult.ring === 'miss') {
    return 'miss';
  }
  return throwResult.label.replace(/^[DST]/, '') || throwResult.label;
};

// Only darts the camera placed on the board keep a landing point: a hand-placed or guessed
// marker is not where the dart landed, and a miss is not drawn on the board.
const landingPoint = (throwResult: ThrowResult) =>
  throwResult.ring === 'miss' || throwResult.placedByHand || throwResult.needsCheck
    ? null
    : throwResult.pointNorm;

// Resolves with the new match id, so an undone final round can remove the match again.
export const saveCompletedMatch = async (
  input: CompletedMatchInput,
): Promise<number | null> => {
  const database = await getDatabase();
  const now = Date.now();
  let matchId: number | null = null;

  await new Promise<void>((resolve, reject) => {
    database.transaction(
      transaction => {
        const playerIdByRuntimeId = new Map<string, number>();

        const insertThrows = () => {
          input.rounds.forEach(round => {
            const databasePlayerId = playerIdByRuntimeId.get(round.playerId);
            if (!databasePlayerId) {
              return;
            }

            round.throws.forEach((throwResult, index) => {
              const point = landingPoint(throwResult);
              executeTransactionSql(transaction, 'INSERT INTO throws (match_id, player_id, round_index, dart_index, score, multiplier, target, is_hit, created_at, point_x, point_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                matchId,
                databasePlayerId,
                round.roundIndex,
                index + 1,
                throwResult.score,
                getMultiplier(throwResult),
                getTarget(throwResult),
                throwResult.ring === 'miss' ? 0 : 1,
                now,
                point?.x ?? null,
                point?.y ?? null,
              ]);
            });
          });
        };

        const insertMatchPlayers = () => {
          // A single winner is kept on the match row; a winning team only on match_players.
          const winnerDatabasePlayerId =
            input.winnerIds.length === 1
              ? playerIdByRuntimeId.get(input.winnerIds[0]) ?? null
              : null;

          executeTransactionSql(
            transaction,
            'UPDATE matches SET winner_player_id = ? WHERE id = ?',
            [winnerDatabasePlayerId, matchId],
          );

          input.players.forEach((player, index) => {
            const databasePlayerId = playerIdByRuntimeId.get(player.id);
            if (!databasePlayerId) {
              return;
            }

            executeTransactionSql(transaction, 'INSERT INTO match_players (match_id, player_id, seat_index, is_winner, team_index, final_score) VALUES (?, ?, ?, ?, ?, ?)', [
              matchId,
              databasePlayerId,
              index,
              input.winnerIds.includes(player.id) ? 1 : 0,
              player.teamIndex ?? null,
              player.finalScore ?? null,
            ]);
          });
          insertThrows();
        };

        const upsertPlayerAtIndex = (index: number) => {
          const player = input.players[index];
          if (!player) {
            insertMatchPlayers();
            return;
          }

          const name = player.name.trim() || getDefaultPlayerName(index);
          executeTransactionSql(
            transaction,
            'INSERT OR IGNORE INTO players (name, created_at) VALUES (?, ?)',
            [name, now],
            () => {
              // Playing again under a deleted (hidden) name brings the player back.
              executeTransactionSql(
                transaction,
                'UPDATE players SET hidden = 0 WHERE name = ?',
                [name],
                () => {
                  executeTransactionSql(
                    transaction,
                    'SELECT id FROM players WHERE name = ?',
                    [name],
                    result => {
                      const databasePlayerId = Number(result.rows.item(0).id);
                      playerIdByRuntimeId.set(player.id, databasePlayerId);
                      upsertPlayerAtIndex(index + 1);
                    },
                  );
                },
              );
            },
          );
        };

        executeTransactionSql(
          transaction,
          'INSERT INTO matches (mode, mode_label, created_at, winner_player_id) VALUES (?, ?, ?, NULL)',
          [input.mode, input.modeLabel, input.createdAt],
          result => {
            matchId = result.insertId ?? null;
            upsertPlayerAtIndex(0);
          },
        );
      },
      error => {
        reject(error);
      },
      () => {
        resolve();
      },
    );
  });
  return matchId;
};

// Removes one saved match; players left without any match are removed too.
export const deleteMatch = async (matchId: number) => {
  const database = await getDatabase();
  await execute(database, 'DELETE FROM throws WHERE match_id = ?', [matchId]);
  await execute(database, 'DELETE FROM match_players WHERE match_id = ?', [matchId]);
  await execute(database, 'DELETE FROM matches WHERE id = ?', [matchId]);
  await execute(
    database,
    'DELETE FROM players WHERE id NOT IN (SELECT player_id FROM match_players)',
  );
};

const findPlayerIdByName = async (database: SQLiteDatabase, name: string) => {
  const result = await execute(database, 'SELECT id FROM players WHERE name = ?', [name]);
  return result.rows.length > 0 ? Number(result.rows.item(0).id) : null;
};

// 'nameTaken' when another player already has the name; the caller may then merge into them.
export const renamePlayer = async (
  playerId: number,
  name: string,
): Promise<'renamed' | 'nameTaken'> => {
  const database = await getDatabase();
  const trimmed = name.trim();
  const existingId = await findPlayerIdByName(database, trimmed);
  if (existingId !== null && existingId !== playerId) {
    return 'nameTaken';
  }
  await execute(database, 'UPDATE players SET name = ? WHERE id = ?', [trimmed, playerId]);
  return 'renamed';
};

// Moves every match of one player onto the player named `name`, then removes the first.
// Refused when both played in the same match, since a match lists each player once.
export const mergePlayerInto = async (
  playerId: number,
  name: string,
): Promise<'merged' | 'sharedMatch'> => {
  const database = await getDatabase();
  const targetId = await findPlayerIdByName(database, name.trim());
  if (targetId === null || targetId === playerId) {
    throw new Error('Merge target not found.');
  }
  const shared = await execute(
    database,
    `SELECT COUNT(*) AS count FROM match_players AS source
    JOIN match_players AS target ON target.match_id = source.match_id
    WHERE source.player_id = ? AND target.player_id = ?`,
    [playerId, targetId],
  );
  if (Number(shared.rows.item(0).count) > 0) {
    return 'sharedMatch';
  }
  await execute(database, 'UPDATE throws SET player_id = ? WHERE player_id = ?', [targetId, playerId]);
  await execute(database, 'UPDATE match_players SET player_id = ? WHERE player_id = ?', [
    targetId,
    playerId,
  ]);
  await execute(database, 'UPDATE matches SET winner_player_id = ? WHERE winner_player_id = ?', [
    targetId,
    playerId,
  ]);
  await execute(database, 'UPDATE players SET hidden = 0 WHERE id = ?', [targetId]);
  await execute(database, 'DELETE FROM players WHERE id = ?', [playerId]);
  return 'merged';
};

// Hides a player from stats and the name list; the matches they played are kept as they are.
export const deletePlayer = async (playerId: number) => {
  const database = await getDatabase();
  await execute(database, 'UPDATE players SET hidden = 1 WHERE id = ?', [playerId]);
};

// Returns known player names, most recently played first; guests and deleted players are left out.
export const listKnownPlayerNames = async (limit = 30): Promise<string[]> => {
  const database = await getDatabase();
  const result = await execute(
    database,
    `SELECT players.name, MAX(matches.created_at) AS last_played_at
    FROM players
    LEFT JOIN match_players ON match_players.player_id = players.id
    LEFT JOIN matches ON matches.id = match_players.match_id
    WHERE players.hidden = 0
    GROUP BY players.id
    ORDER BY last_played_at DESC, players.created_at DESC`,
  );

  return Array.from({ length: result.rows.length }, (_, index) =>
    String(result.rows.item(index).name),
  )
    .filter(name => !isDefaultPlayerName(name))
    .slice(0, limit);
};

export const listRecentMatches = async (limit = 20): Promise<RecentMatchSummary[]> => {
  const database = await getDatabase();
  const result = await execute(
    database,
    `SELECT
      matches.id,
      matches.mode,
      matches.mode_label,
      matches.created_at,
      COUNT(match_players.id) AS player_count,
      GROUP_CONCAT(CASE WHEN match_players.is_winner = 1 THEN players.name END, '、') AS winner_name
    FROM matches
    LEFT JOIN match_players ON match_players.match_id = matches.id
    LEFT JOIN players ON players.id = match_players.player_id
    GROUP BY matches.id
    ORDER BY matches.created_at DESC
    LIMIT ?`,
    [limit],
  );

  return Array.from({ length: result.rows.length }, (_, index) => {
    const row = result.rows.item(index);
    return {
      id: Number(row.id),
      mode: String(row.mode),
      modeLabel: row.mode_label === null ? null : String(row.mode_label),
      createdAt: Number(row.created_at),
      playerCount: Number(row.player_count),
      winnerName: row.winner_name === null ? null : String(row.winner_name),
    };
  });
};

const X01_MODES = ['game301', 'game501', 'game701'];

const toNullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

export const getMatchDetail = async (matchId: number): Promise<MatchDetail | null> => {
  const database = await getDatabase();
  const matchResult = await execute(
    database,
    'SELECT id, mode, mode_label, created_at FROM matches WHERE id = ?',
    [matchId],
  );
  if (matchResult.rows.length === 0) {
    return null;
  }
  const match = matchResult.rows.item(0);

  const playerResult = await execute(
    database,
    `SELECT match_players.player_id, match_players.seat_index, match_players.is_winner,
      match_players.team_index, players.name
    FROM match_players
    JOIN players ON players.id = match_players.player_id
    WHERE match_players.match_id = ?
    ORDER BY match_players.seat_index`,
    [matchId],
  );
  const throwResult = await execute(
    database,
    `SELECT player_id, round_index, dart_index, score, multiplier, target
    FROM throws
    WHERE match_id = ?
    ORDER BY round_index, player_id, dart_index`,
    [matchId],
  );

  const rounds: MatchDetailRound[] = [];
  for (let index = 0; index < throwResult.rows.length; index += 1) {
    const row = throwResult.rows.item(index);
    const playerId = Number(row.player_id);
    const roundIndex = Number(row.round_index);
    let round = rounds[rounds.length - 1];
    if (!round || round.playerId !== playerId || round.roundIndex !== roundIndex) {
      round = { playerId, roundIndex, throws: [] };
      rounds.push(round);
    }
    round.throws.push({
      dartIndex: Number(row.dart_index),
      score: Number(row.score ?? 0),
      multiplier: Number(row.multiplier ?? 0),
      target: String(row.target ?? 'miss'),
    });
  }

  return {
    id: Number(match.id),
    mode: String(match.mode),
    modeLabel: match.mode_label === null ? null : String(match.mode_label),
    createdAt: Number(match.created_at),
    players: Array.from({ length: playerResult.rows.length }, (_, index) => {
      const row = playerResult.rows.item(index);
      return {
        playerId: Number(row.player_id),
        name: String(row.name),
        seatIndex: Number(row.seat_index),
        isWinner: Number(row.is_winner) === 1,
        teamIndex: row.team_index === null || row.team_index === undefined ? null : Number(row.team_index),
      };
    }),
    rounds,
  };
};

export const listPlayerStats = async (): Promise<PlayerStats[]> => {
  const database = await getDatabase();
  const x01Placeholders = X01_MODES.map(() => '?').join(', ');
  const result = await execute(
    database,
    `WITH round_totals AS (
      SELECT throws.player_id, matches.mode, SUM(throws.score) AS total
      FROM throws
      JOIN matches ON matches.id = throws.match_id
      GROUP BY throws.player_id, throws.match_id, throws.round_index
    ),
    round_stats AS (
      SELECT
        player_id,
        AVG(CASE WHEN mode IN (${x01Placeholders}) THEN total END) AS x01_average,
        MAX(total) AS best_round
      FROM round_totals
      GROUP BY player_id
    ),
    match_stats AS (
      SELECT player_id, COUNT(*) AS matches_played, SUM(is_winner) AS wins
      FROM match_players
      GROUP BY player_id
    )
    SELECT players.id, players.name, match_stats.matches_played, match_stats.wins,
      round_stats.x01_average, round_stats.best_round
    FROM players
    JOIN match_stats ON match_stats.player_id = players.id
    LEFT JOIN round_stats ON round_stats.player_id = players.id
    WHERE players.hidden = 0
    ORDER BY match_stats.matches_played DESC, players.name`,
    X01_MODES,
  );

  return Array.from({ length: result.rows.length }, (_, index) => {
    const row = result.rows.item(index);
    return {
      playerId: Number(row.id),
      name: String(row.name),
      matchesPlayed: Number(row.matches_played),
      wins: Number(row.wins ?? 0),
      x01Average: toNullableNumber(row.x01_average),
      bestRound: toNullableNumber(row.best_round),
    };
  }).filter(player => !isDefaultPlayerName(player.name));
};

// Modes whose final score is a result worth a personal best.
const BEST_SCORE_MODES = [
  'highScore',
  'darts99',
  'shanghai',
  'halfIt',
  'bermuda',
  'hammerCricket',
  'catch40',
  'checkout4160',
];

// Cricket modes with fixed targets, so marks can be counted from the saved throws.
// Value = lowest number; 20 and the bull always count.
const MPR_TARGETS: Record<string, number> = {
  cricket: 15,
  cricketNoScore: 15,
  cutThroat: 15,
  tactics: 10,
};

// Matches shown in a mode's trend.
const TREND_LENGTH = 10;

const X01_STARTING_SCORES: Record<string, number> = { game301: 301, game501: 501, game701: 701 };

// One dart can finish it: an even score up to 40 (a double) or 50 (the inner bull).
const isOneDartFinish = (left: number) => left === 50 || (left > 0 && left <= 40 && left % 2 === 0);

// Per X01 match: darts this player threw at a one-dart finish, and how many of them won.
// Replays every round of the match, since teammates share one score and a bust puts it back.
const countCheckoutAttempts = async (database: SQLiteDatabase, playerId: number) => {
  const rows = rowsOf(
    await execute(
      database,
      `SELECT throws.match_id, throws.player_id, throws.round_index, throws.score,
        throws.multiplier, matches.mode, match_players.team_index
      FROM throws
      JOIN matches ON matches.id = throws.match_id
      JOIN match_players ON match_players.match_id = throws.match_id
        AND match_players.player_id = throws.player_id
      WHERE matches.mode IN (${X01_MODES.map(() => '?').join(', ')})
        AND throws.match_id IN (SELECT match_id FROM match_players WHERE player_id = ?)
      ORDER BY throws.id`,
      [...X01_MODES, playerId],
    ),
  );
  const counts = new Map<number, { attempts: number; hits: number }>();
  const scoreLeft = new Map<string, number>();
  let start = 0;
  while (start < rows.length) {
    const first = rows[start];
    let end = start + 1;
    while (
      end < rows.length &&
      rows[end].match_id === first.match_id &&
      rows[end].player_id === first.player_id &&
      rows[end].round_index === first.round_index
    ) {
      end += 1;
    }
    const round = rows.slice(start, end);
    start = end;

    const matchId = Number(first.match_id);
    const side = `${matchId}|${first.team_index ?? `p${first.player_id}`}`;
    const matchCounts = counts.get(matchId) ?? { attempts: 0, hits: 0 };
    counts.set(matchId, matchCounts);
    const isMine = Number(first.player_id) === playerId;
    let left = scoreLeft.get(side) ?? X01_STARTING_SCORES[String(first.mode)];
    const roundStart = left;
    round.forEach(dart => {
      const score = Number(dart.score ?? 0);
      if (isMine && isOneDartFinish(left)) {
        matchCounts.attempts += 1;
        // A double or the inner bull (both saved with multiplier 2).
        if (score === left && Number(dart.multiplier) === 2) {
          matchCounts.hits += 1;
        }
      }
      left -= score;
    });
    // Same bust rule as the X01 engine: below zero, one left, or zero without a double.
    const doubleOut = Number(round[round.length - 1].multiplier) === 2;
    scoreLeft.set(side, left > 1 || (left === 0 && doubleOut) ? left : roundStart);
  }
  return counts;
};

type SavedDart = { score: number; multiplier: number; target: string; point: BoardPoint | null };

// Board sector of a saved dart: 1-20, 25 for either bull, 0 for a miss.
const savedSector = (dart: SavedDart) => {
  if (dart.target === 'IB' || dart.target === 'OB') {
    return 25;
  }
  return Number(dart.target) || 0;
};

// Same test as the Shanghai / Half it / Bermuda engine; the inner bull counts as a double.
const hitsRoundTarget = (dart: SavedDart, target: HalfItTarget) => {
  if (target === 'double') {
    return dart.multiplier === 2;
  }
  if (target === 'triple') {
    return dart.multiplier === 3;
  }
  if (target === 'innerBull') {
    return dart.target === 'IB';
  }
  return savedSector(dart) === target;
};

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

export const getPlayerDetail = async (playerId: number): Promise<PlayerDetail | null> => {
  const database = await getDatabase();
  const playerResult = await execute(database, 'SELECT name FROM players WHERE id = ?', [playerId]);
  if (playerResult.rows.length === 0) {
    return null;
  }

  const matchResult = await execute(
    database,
    `SELECT matches.id, matches.mode, matches.mode_label, matches.created_at,
      match_players.is_winner, match_players.team_index, match_players.final_score
    FROM match_players
    JOIN matches ON matches.id = match_players.match_id
    WHERE match_players.player_id = ?
    ORDER BY matches.created_at`,
    [playerId],
  );
  const matches = Array.from({ length: matchResult.rows.length }, (_, index) => {
    const row = matchResult.rows.item(index);
    return {
      id: Number(row.id),
      mode: String(row.mode),
      modeLabel: row.mode_label === null ? null : String(row.mode_label),
      createdAt: Number(row.created_at),
      isWinner: Number(row.is_winner) === 1,
      isTeam: row.team_index !== null && row.team_index !== undefined,
      finalScore: toNullableNumber(row.final_score),
    };
  });

  // This player's rounds per match, in throwing order.
  const throwResult = await execute(
    database,
    `SELECT match_id, round_index, score, multiplier, target, point_x, point_y FROM throws
    WHERE player_id = ?
    ORDER BY match_id, round_index, dart_index`,
    [playerId],
  );
  const roundsByMatch = new Map<number, Map<number, SavedDart[]>>();
  for (let index = 0; index < throwResult.rows.length; index += 1) {
    const row = throwResult.rows.item(index);
    const matchId = Number(row.match_id);
    const rounds = roundsByMatch.get(matchId) ?? new Map();
    roundsByMatch.set(matchId, rounds);
    const roundIndex = Number(row.round_index);
    const darts = rounds.get(roundIndex) ?? [];
    rounds.set(roundIndex, darts);
    darts.push({
      score: Number(row.score ?? 0),
      multiplier: Number(row.multiplier ?? 0),
      target: String(row.target ?? 'miss'),
      point:
        row.point_x === null || row.point_x === undefined
          ? null
          : { x: Number(row.point_x), y: Number(row.point_y) },
    });
  }

  // The last saved round of each match (rounds are saved in throwing order), for checkouts.
  const lastRoundResult = await execute(
    database,
    `SELECT match_id, player_id, round_index FROM throws
    WHERE id IN (
      SELECT MAX(id) FROM throws
      WHERE match_id IN (SELECT match_id FROM match_players WHERE player_id = ?)
      GROUP BY match_id
    )`,
    [playerId],
  );
  const finishingRound = new Map<number, number>();
  for (let index = 0; index < lastRoundResult.rows.length; index += 1) {
    const row = lastRoundResult.rows.item(index);
    if (Number(row.player_id) === playerId) {
      finishingRound.set(Number(row.match_id), Number(row.round_index));
    }
  }

  const matchRounds = (matchId: number) => [...(roundsByMatch.get(matchId)?.values() ?? [])];
  const dartsOf = (matchId: number) => matchRounds(matchId).flat();
  const roundTotals = (matchId: number) =>
    matchRounds(matchId).map(darts => darts.reduce((sum, dart) => sum + dart.score, 0));
  const checkoutsByMatch = await countCheckoutAttempts(database, playerId);
  const soloMatches = (matchList: typeof matches) => matchList.filter(match => !match.isTeam);
  const bestAndAverage = (values: number[]) =>
    values.length > 0 ? { best: Math.min(...values), average: average(values) } : null;

  const countSegments = (matchList: typeof matches) => {
    const counts = new Map<string, PlayerSegmentCount>();
    matchList.forEach(match =>
      dartsOf(match.id).forEach(dart => {
        const key = `${dart.target}|${dart.multiplier}`;
        const segment = counts.get(key) ?? {
          target: dart.target,
          multiplier: dart.multiplier,
          count: 0,
        };
        segment.count += 1;
        counts.set(key, segment);
      }),
    );
    return [...counts.values()];
  };
  const landingPoints = (matchList: typeof matches) =>
    matchList.flatMap(match => dartsOf(match.id).flatMap(dart => (dart.point ? [dart.point] : [])));

  const buildX01Stats = (x01Matches: typeof matches): PlayerX01Stats | null => {
    const x01Rounds = x01Matches.flatMap(match => roundTotals(match.id));
    if (x01Rounds.length === 0) {
      return null;
    }
    const checkouts = x01Matches
      .filter(match => match.isWinner && finishingRound.has(match.id))
      .map(match =>
        (roundsByMatch.get(match.id)?.get(finishingRound.get(match.id)!) ?? []).reduce(
          (sum, dart) => sum + dart.score,
          0,
        ),
      );
    const countRounds = (low: number, high: number) =>
      x01Rounds.filter(total => total >= low && total <= high).length;
    return {
      average: average(x01Rounds),
      first9Average: average(x01Matches.flatMap(match => roundTotals(match.id).slice(0, 3))),
      count60: countRounds(60, 99),
      count100: countRounds(100, 139),
      count140: countRounds(140, 179),
      count180: countRounds(180, 180),
      bestCheckout: checkouts.length > 0 ? Math.max(...checkouts) : null,
      checkoutAttempts: x01Matches.reduce(
        (sum, match) => sum + (checkoutsByMatch.get(match.id)?.attempts ?? 0),
        0,
      ),
      checkoutHits: x01Matches.reduce(
        (sum, match) => sum + (checkoutsByMatch.get(match.id)?.hits ?? 0),
        0,
      ),
      dartsPerLeg: bestAndAverage(
        soloMatches(x01Matches)
          .filter(match => match.isWinner)
          .map(match => dartsOf(match.id).length),
      ),
    };
  };

  const marksOf = (mode: string, darts: SavedDart[]) =>
    darts.reduce((sum, dart) => {
      if (dart.target === 'IB' || dart.target === 'OB') {
        return sum + dart.multiplier;
      }
      const sector = Number(dart.target);
      return sector >= MPR_TARGETS[mode] && sector <= 20 ? sum + dart.multiplier : sum;
    }, 0);
  const matchMarks = (match: (typeof matches)[number]) =>
    matchRounds(match.id).map(darts => marksOf(match.mode, darts));

  const buildCricketStats = (mode: string, modeMatches: typeof matches) => {
    if (MPR_TARGETS[mode] === undefined) {
      return null;
    }
    const marks = modeMatches.map(matchMarks);
    const rounds = marks.flat();
    return rounds.length > 0
      ? {
          mpr: average(rounds),
          first9Mpr: average(marks.flatMap(match => match.slice(0, 3))),
          count5Marks: rounds.filter(count => count >= 5).length,
        }
      : null;
  };

  const buildDarts99Stats = (modeMatches: typeof matches) => {
    const darts = modeMatches.flatMap(match => dartsOf(match.id));
    const share = (multiplier: number | null) =>
      darts.filter(
        dart =>
          dart.target === String(DARTS_99_TARGET) &&
          (multiplier === null || dart.multiplier === multiplier),
      ).length / darts.length;
    return darts.length > 0
      ? { hitRate: share(null), tripleRate: share(3), doubleRate: share(2) }
      : null;
  };

  // Solo matches only: a team shares its progress, which this player's darts alone do not show.
  const buildAroundTheClockStats = (modeMatches: typeof matches) => {
    let hits = 0;
    let thrown = 0;
    const finishes: number[] = [];
    soloMatches(modeMatches).forEach(match => {
      let progress = 0;
      const darts = dartsOf(match.id);
      darts.forEach(dart => {
        thrown += 1;
        if (savedSector(dart) === getAroundTheClockTarget(progress)) {
          progress += 1;
          hits += 1;
        }
      });
      if (match.isWinner && progress >= AROUND_THE_CLOCK_TARGETS.length) {
        finishes.push(darts.length);
      }
    });
    return thrown > 0 ? { hitRate: hits / thrown, dartsToFinish: bestAndAverage(finishes) } : null;
  };

  // The round number picks the target, so team rounds work too (it counts the team's rounds).
  const buildTargetRoundsStats = (mode: TargetRoundsType, modeMatches: typeof matches) => {
    let hits = 0;
    let thrown = 0;
    let shanghais = 0;
    let halved = 0;
    modeMatches.forEach(match =>
      roundsByMatch.get(match.id)?.forEach((darts, roundIndex) => {
        const target = getRoundTarget(mode, roundIndex);
        if (target === null) {
          return;
        }
        const roundHits = darts.filter(dart => hitsRoundTarget(dart, target));
        hits += roundHits.length;
        thrown += darts.length;
        const rings = new Set(roundHits.map(dart => dart.multiplier));
        if (mode === 'shanghai' && rings.has(1) && rings.has(2) && rings.has(3)) {
          shanghais += 1;
        }
        if (mode !== 'shanghai' && roundHits.length === 0) {
          halved += 1;
        }
      }),
    );
    return thrown > 0
      ? { hitRate: hits / thrown, shanghais, halvedPerMatch: halved / modeMatches.length }
      : null;
  };

  // Replays each solo match like the drill engine: a finish or running out of darts moves on.
  const buildCheckoutDrillStats = (mode: CheckoutDrillType, modeMatches: typeof matches) => {
    const { first, last, maxDarts } = CHECKOUT_DRILLS[mode];
    let finished = 0;
    let attempted = 0;
    const finishDarts: number[] = [];
    soloMatches(modeMatches).forEach(match => {
      let target: number | null = first;
      let remaining = first;
      let dartsUsed = 0;
      for (const darts of matchRounds(match.id)) {
        if (target === null) {
          break;
        }
        let left = remaining;
        let done = false;
        for (const [index, dart] of darts.entries()) {
          const next = left - dart.score;
          if (next === 0 && dart.multiplier === 2) {
            done = true;
            finishDarts.push(dartsUsed + index + 1);
            break;
          }
          if (next <= 1) {
            left = remaining;
            break;
          }
          left = next;
        }
        if (done || dartsUsed + 3 >= maxDarts) {
          attempted += 1;
          finished += done ? 1 : 0;
          target = target < last ? target + 1 : null;
          remaining = target ?? 0;
          dartsUsed = 0;
        } else {
          remaining = left;
          dartsUsed += 3;
        }
      }
    });
    return attempted > 0
      ? {
          finished,
          attempted,
          averageDarts: finishDarts.length > 0 ? average(finishDarts) : null,
        }
      : null;
  };

  const trendValue = (match: (typeof matches)[number]) => {
    if (X01_MODES.includes(match.mode)) {
      const totals = roundTotals(match.id);
      return totals.length > 0 ? average(totals) : null;
    }
    if (MPR_TARGETS[match.mode] !== undefined) {
      const marks = matchMarks(match);
      return marks.length > 0 ? average(marks) : null;
    }
    if (BEST_SCORE_MODES.includes(match.mode)) {
      return match.isTeam ? null : match.finalScore;
    }
    if (match.mode === 'aroundTheClock' && match.isWinner && !match.isTeam) {
      return dartsOf(match.id).length;
    }
    return null;
  };

  const modes: PlayerModeStats[] = [];
  matches.forEach(match => {
    let stats = modes.find(item => item.mode === match.mode);
    if (!stats) {
      stats = {
        mode: match.mode,
        modeLabel: match.modeLabel,
        matchesPlayed: 0,
        wins: 0,
        bestScore: null,
        averageScore: null,
        x01: null,
        cricket: null,
        rounds: null,
        darts99: null,
        aroundTheClock: null,
        targetRounds: null,
        checkoutDrill: null,
        trend: [],
        segments: [],
        points: [],
        matches: [],
      };
      modes.push(stats);
    }
    stats.matchesPlayed += 1;
    stats.wins += match.isWinner ? 1 : 0;
    // Team scores are shared, so only solo matches count as a personal best.
    const score =
      BEST_SCORE_MODES.includes(match.mode) && !match.isTeam ? match.finalScore : null;
    if (score !== null) {
      stats.bestScore = Math.max(stats.bestScore ?? score, score);
    }
    const totals = roundTotals(match.id);
    stats.matches.unshift({
      matchId: match.id,
      createdAt: match.createdAt,
      isWinner: match.isWinner,
      score,
      average: X01_MODES.includes(match.mode) && totals.length > 0 ? average(totals) : null,
    });
    const value = trendValue(match);
    if (value !== null) {
      stats.trend = [
        ...stats.trend,
        { matchId: match.id, createdAt: match.createdAt, value },
      ].slice(-TREND_LENGTH);
    }
  });
  modes.forEach(stats => {
    const mode = stats.mode;
    const modeMatches = matches.filter(match => match.mode === mode);
    const scores = stats.matches.flatMap(match => (match.score === null ? [] : [match.score]));
    stats.averageScore = scores.length > 0 ? average(scores) : null;
    stats.x01 = X01_MODES.includes(mode) ? buildX01Stats(modeMatches) : null;
    stats.cricket = buildCricketStats(mode, modeMatches);
    if (mode === 'highScore') {
      const totals = modeMatches.flatMap(match => roundTotals(match.id));
      stats.rounds =
        totals.length > 0 ? { average: average(totals), best: Math.max(...totals) } : null;
    }
    if (mode === 'darts99') {
      stats.darts99 = buildDarts99Stats(modeMatches);
    }
    if (mode === 'aroundTheClock') {
      stats.aroundTheClock = buildAroundTheClockStats(modeMatches);
    }
    if (mode === 'shanghai' || mode === 'halfIt' || mode === 'bermuda') {
      stats.targetRounds = buildTargetRoundsStats(mode, modeMatches);
    }
    if (mode === 'catch40' || mode === 'checkout4160') {
      stats.checkoutDrill = buildCheckoutDrillStats(mode, modeMatches);
    }
    stats.segments = countSegments(modeMatches);
    stats.points = landingPoints(modeMatches);
  });
  modes.sort((left, right) => right.matchesPlayed - left.matchesPlayed);

  return {
    playerId,
    name: String(playerResult.rows.item(0).name),
    matchesPlayed: matches.length,
    wins: matches.filter(match => match.isWinner).length,
    modes,
    segments: countSegments(matches),
    points: landingPoints(matches),
  };
};

export const getSetting = async (key: string): Promise<string | null> => {
  const database = await getDatabase();
  const result = await execute(database, 'SELECT value FROM settings WHERE key = ?', [key]);
  return result.rows.length > 0 ? String(result.rows.item(0).value) : null;
};

export const setSetting = async (key: string, value: string) => {
  const database = await getDatabase();
  await execute(
    database,
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value],
  );
};

// Deletes all saved matches and players; settings are kept.
export const clearHistory = async () => {
  const database = await getDatabase();
  await execute(database, 'DELETE FROM throws');
  await execute(database, 'DELETE FROM match_players');
  await execute(database, 'DELETE FROM matches');
  await execute(database, 'DELETE FROM players');
};

// Backup file layout. Players are referenced by name, which is their identity across phones.
const BACKUP_APP = 'BullTrack';
const BACKUP_KIND = 'history';
const BACKUP_VERSION = 1;

interface BackupMatch {
  mode: string;
  modeLabel: string | null;
  createdAt: number;
  winner: string | null;
  players: Array<{
    name: string;
    seat: number;
    winner: boolean;
    team: number | null;
    finalScore: number | null;
  }>;
  // In throwing order.
  throws: Array<{
    player: string;
    round: number;
    dart: number;
    score: number | null;
    multiplier: number | null;
    target: string | null;
    hit: number | null;
    at: number;
    // Landing point, only present when known (absent in older backups).
    x?: number;
    y?: number;
  }>;
}

interface HistoryBackup {
  app: string;
  kind: string;
  version: number;
  exportedAt: number;
  players: Array<{ name: string; hidden: boolean }>;
  matches: BackupMatch[];
}

const rowsOf = (result: ResultSet) =>
  Array.from({ length: result.rows.length }, (_, index) => result.rows.item(index));

// All matches and players as backup JSON; settings stay on the phone.
export const exportHistory = async (exportedAt = Date.now()): Promise<string> => {
  const database = await getDatabase();
  const players = rowsOf(await execute(database, 'SELECT name, hidden FROM players ORDER BY id'));
  const matchRows = rowsOf(
    await execute(
      database,
      `SELECT matches.id, matches.mode, matches.mode_label, matches.created_at, players.name AS winner
      FROM matches
      LEFT JOIN players ON players.id = matches.winner_player_id
      ORDER BY matches.created_at`,
    ),
  );
  const seatRows = rowsOf(
    await execute(
      database,
      `SELECT match_players.match_id, players.name, match_players.seat_index, match_players.is_winner,
        match_players.team_index, match_players.final_score
      FROM match_players
      JOIN players ON players.id = match_players.player_id
      ORDER BY match_players.match_id, match_players.seat_index`,
    ),
  );
  const throwRows = rowsOf(
    await execute(
      database,
      `SELECT throws.match_id, players.name, throws.round_index, throws.dart_index, throws.score,
        throws.multiplier, throws.target, throws.is_hit, throws.created_at, throws.point_x,
        throws.point_y
      FROM throws
      JOIN players ON players.id = throws.player_id
      ORDER BY throws.id`,
    ),
  );

  const matches = new Map<number, BackupMatch>();
  matchRows.forEach(row => {
    matches.set(Number(row.id), {
      mode: String(row.mode),
      modeLabel: row.mode_label === null ? null : String(row.mode_label),
      createdAt: Number(row.created_at),
      winner: row.winner === null || row.winner === undefined ? null : String(row.winner),
      players: [],
      throws: [],
    });
  });
  seatRows.forEach(row => {
    matches.get(Number(row.match_id))?.players.push({
      name: String(row.name),
      seat: Number(row.seat_index),
      winner: Number(row.is_winner) === 1,
      team: toNullableNumber(row.team_index),
      finalScore: toNullableNumber(row.final_score),
    });
  });
  throwRows.forEach(row => {
    matches.get(Number(row.match_id))?.throws.push({
      player: String(row.name),
      round: Number(row.round_index),
      dart: Number(row.dart_index),
      score: toNullableNumber(row.score),
      multiplier: toNullableNumber(row.multiplier),
      target: row.target === null ? null : String(row.target),
      hit: toNullableNumber(row.is_hit),
      at: Number(row.created_at),
      ...(row.point_x === null || row.point_x === undefined
        ? {}
        : { x: Number(row.point_x), y: Number(row.point_y) }),
    });
  });

  const backup: HistoryBackup = {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt,
    players: players.map(row => ({ name: String(row.name), hidden: Number(row.hidden) === 1 })),
    matches: [...matches.values()],
  };
  return JSON.stringify(backup);
};

export type ImportHistoryResult =
  | { status: 'invalid' }
  | { status: 'imported'; added: number; skipped: number };

const parseBackup = (text: string): HistoryBackup | null => {
  try {
    const backup = JSON.parse(text) as HistoryBackup;
    const valid =
      backup?.app === BACKUP_APP &&
      backup.kind === BACKUP_KIND &&
      typeof backup.version === 'number' &&
      backup.version <= BACKUP_VERSION &&
      Array.isArray(backup.players) &&
      Array.isArray(backup.matches);
    return valid ? backup : null;
  } catch {
    return null;
  }
};

const matchKey = (mode: string, createdAt: number) => `${mode}|${createdAt}`;

// Merges a backup into the phone's history: players join by name (a local player keeps
// their own hidden state) and a match already here (same mode and start time) is skipped.
export const importHistory = async (text: string): Promise<ImportHistoryResult> => {
  const backup = parseBackup(text);
  if (!backup) {
    return { status: 'invalid' };
  }
  const database = await getDatabase();
  const existing = new Set(
    rowsOf(await execute(database, 'SELECT mode, created_at FROM matches')).map(row =>
      matchKey(String(row.mode), Number(row.created_at)),
    ),
  );
  const newMatches = backup.matches.filter(match => {
    const key = matchKey(match.mode, match.createdAt);
    if (existing.has(key)) {
      return false;
    }
    existing.add(key);
    return true;
  });
  const hiddenByName = new Map(backup.players.map(player => [player.name, player.hidden]));
  const names = new Set(
    newMatches.flatMap(match => [
      ...match.players.map(player => player.name),
      ...match.throws.map(dart => dart.player),
    ]),
  );
  const now = Date.now();
  const playerId = '(SELECT id FROM players WHERE name = ?)';

  await new Promise<void>((resolve, reject) => {
    database.transaction(
      transaction => {
        names.forEach(name => {
          executeTransactionSql(
            transaction,
            'INSERT OR IGNORE INTO players (name, created_at, hidden) VALUES (?, ?, ?)',
            [name, now, hiddenByName.get(name) ? 1 : 0],
          );
        });
        newMatches.forEach(match => {
          executeTransactionSql(
            transaction,
            `INSERT INTO matches (mode, mode_label, created_at, winner_player_id) VALUES (?, ?, ?, ${playerId})`,
            [match.mode, match.modeLabel, match.createdAt, match.winner],
            result => {
              const matchId = result.insertId ?? null;
              match.players.forEach(player => {
                executeTransactionSql(
                  transaction,
                  `INSERT INTO match_players (match_id, player_id, seat_index, is_winner, team_index, final_score) VALUES (?, ${playerId}, ?, ?, ?, ?)`,
                  [matchId, player.name, player.seat, player.winner ? 1 : 0, player.team, player.finalScore],
                );
              });
              match.throws.forEach(dart => {
                executeTransactionSql(
                  transaction,
                  `INSERT INTO throws (match_id, player_id, round_index, dart_index, score, multiplier, target, is_hit, created_at, point_x, point_y) VALUES (?, ${playerId}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [matchId, dart.player, dart.round, dart.dart, dart.score, dart.multiplier, dart.target, dart.hit, dart.at, dart.x ?? null, dart.y ?? null],
                );
              });
            },
          );
        });
      },
      error => reject(error),
      () => resolve(),
    );
  });

  return {
    status: 'imported',
    added: newMatches.length,
    skipped: backup.matches.length - newMatches.length,
  };
};
