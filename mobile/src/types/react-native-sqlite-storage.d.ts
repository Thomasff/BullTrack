declare module 'react-native-sqlite-storage' {
  export interface ResultSetRowList {
    length: number;
    item(index: number): Record<string, unknown>;
  }

  export interface ResultSet {
    insertId?: number;
    rowsAffected: number;
    rows: ResultSetRowList;
  }

  export interface Transaction {
    executeSql(
      sqlStatement: string,
      args?: Array<string | number | null>,
      callback?: (transaction: Transaction, resultSet: ResultSet) => void,
      errorCallback?: (transaction: Transaction, error: Error) => boolean,
    ): void;
  }

  export interface SQLiteDatabase {
    executeSql(
      sqlStatement: string,
      args?: Array<string | number | null>,
    ): Promise<[ResultSet]>;
    transaction(
      callback: (transaction: Transaction) => void,
      errorCallback?: (error: Error) => void,
      successCallback?: () => void,
    ): void;
  }

  interface SQLiteStatic {
    DEBUG(enabled: boolean): void;
    enablePromise(enabled: boolean): void;
    openDatabase(options: {
      name: string;
      location?: string;
    }): Promise<SQLiteDatabase>;
  }

  const SQLite: SQLiteStatic;
  export default SQLite;
}
