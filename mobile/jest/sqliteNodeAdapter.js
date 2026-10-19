// Test-only stand-in for react-native-sqlite-storage backed by Node's built-in SQLite.
// It mimics the promise-mode executeSql and the WebSQL-style transaction callbacks.
const { DatabaseSync } = require('node:sqlite');

const toResultSet = (database, sql, params) => {
  const statement = database.prepare(sql);
  const values = params.map(value => (value === undefined ? null : value));
  if (statement.columns().length > 0) {
    const rows = statement.all(...values);
    return {
      insertId: undefined,
      rowsAffected: 0,
      rows: { length: rows.length, item: index => rows[index], raw: () => rows },
    };
  }
  const info = statement.run(...values);
  return {
    insertId: Number(info.lastInsertRowid),
    rowsAffected: Number(info.changes),
    rows: { length: 0, item: () => undefined, raw: () => [] },
  };
};

const createDatabase = () => {
  const database = new DatabaseSync(':memory:');

  return {
    executeSql: async (sql, params = []) => [toResultSet(database, sql, params)],
    transaction: (callback, onError, onSuccess) => {
      setTimeout(() => {
        const queue = [];
        const transaction = {
          executeSql: (sql, params = [], success, error) => {
            queue.push({ sql, params, success, error });
          },
        };
        database.exec('BEGIN');
        try {
          callback(transaction);
          while (queue.length > 0) {
            const item = queue.shift();
            let result;
            try {
              result = toResultSet(database, item.sql, item.params);
            } catch (statementError) {
              const fatal = item.error ? item.error(transaction, statementError) : true;
              if (fatal !== false) {
                throw statementError;
              }
              continue;
            }
            item.success?.(transaction, result);
          }
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          onError?.(error);
          return;
        }
        onSuccess?.();
      }, 0);
    },
    close: async () => database.close(),
  };
};

module.exports = {
  __esModule: true,
  default: {
    DEBUG: () => undefined,
    enablePromise: () => undefined,
    openDatabase: async () => createDatabase(),
  },
};
