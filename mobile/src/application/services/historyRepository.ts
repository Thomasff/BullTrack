import SQLite, {
  type ResultSet,
  type SQLiteDatabase,
  type Transaction,
} from 'react-native-sqlite-storage';
import type {
  CompletedMatchInput,
  RecentMatchSummary,
} from '../../domain/history/types';
import type { ThrowResult } from '../../domain/game/types';

SQLite.DEBUG(false);
SQLite.enablePromise(true);

const DATABASE_NAME = 'bulltrack_history.db';
const SCHEMA_VERSION = 1;

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

export const saveCompletedMatch = async (input: CompletedMatchInput) => {
  const database = await getDatabase();
  const now = Date.now();

  await new Promise<void>((resolve, reject) => {
    database.transaction(
      transaction => {
        const playerIdByRuntimeId = new Map<string, number>();
        let matchId: number | null = null;

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
          const winnerDatabasePlayerId = input.winnerId
            ? playerIdByRuntimeId.get(input.winnerId) ?? null
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

            executeTransactionSql(transaction, 'INSERT INTO match_players (match_id, player_id, seat_index, is_winner) VALUES (?, ?, ?, ?)', [
              matchId,
              databasePlayerId,
              index,
              player.id === input.winnerId ? 1 : 0,
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

          const name = player.name.trim() || `Player ${index + 1}`;
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
      winner.name AS winner_name
    FROM matches
    LEFT JOIN match_players ON match_players.match_id = matches.id
    LEFT JOIN players AS winner ON winner.id = matches.winner_player_id
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
