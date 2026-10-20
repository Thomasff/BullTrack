import SQLite, {
  type ResultSet,
  type SQLiteDatabase,
  type Transaction,
} from 'react-native-sqlite-storage';
import type {
  CompletedMatchInput,
  MatchDetail,
  MatchDetailRound,
  PlayerStats,
  RecentMatchSummary,
} from '../../domain/history/types';
import type { ThrowResult } from '../../domain/game/types';
import { getDefaultPlayerName } from '../../domain/game/players';

SQLite.DEBUG(false);
SQLite.enablePromise(true);

const DATABASE_NAME = 'bulltrack_history.db';
// All schema statements are idempotent, so older versions simply re-run them.
const SCHEMA_VERSION = 3;

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
      created_at INTEGER NOT NULL
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
  // Schema v3: team games. Fresh installs get the column from CREATE TABLE above.
  const matchPlayerColumns = await execute(database, 'PRAGMA table_info(match_players)');
  const hasTeamIndex = Array.from(
    { length: matchPlayerColumns.rows.length },
    (_, index) => matchPlayerColumns.rows.item(index).name,
  ).includes('team_index');
  if (!hasTeamIndex) {
    await execute(database, 'ALTER TABLE match_players ADD COLUMN team_index INTEGER');
  }
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
              executeTransactionSql(transaction, 'INSERT INTO throws (match_id, player_id, round_index, dart_index, score, multiplier, target, is_hit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                matchId,
                databasePlayerId,
                round.roundIndex,
                index + 1,
                throwResult.score,
                getMultiplier(throwResult),
                getTarget(throwResult),
                throwResult.ring === 'miss' ? 0 : 1,
                now,
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

            executeTransactionSql(transaction, 'INSERT INTO match_players (match_id, player_id, seat_index, is_winner, team_index) VALUES (?, ?, ?, ?, ?)', [
              matchId,
              databasePlayerId,
              index,
              input.winnerIds.includes(player.id) ? 1 : 0,
              player.teamIndex ?? null,
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

// Returns known player names, most recently played first.
export const listKnownPlayerNames = async (limit = 30): Promise<string[]> => {
  const database = await getDatabase();
  const result = await execute(
    database,
    `SELECT players.name, MAX(matches.created_at) AS last_played_at
    FROM players
    LEFT JOIN match_players ON match_players.player_id = players.id
    LEFT JOIN matches ON matches.id = match_players.match_id
    GROUP BY players.id
    ORDER BY last_played_at DESC, players.created_at DESC
    LIMIT ?`,
    [limit],
  );

  return Array.from({ length: result.rows.length }, (_, index) =>
    String(result.rows.item(index).name),
  );
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
  });
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
