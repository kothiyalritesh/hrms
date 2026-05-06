/**
 * Development Mode Supabase Proxy
 * Mocks Supabase operations when DEV_MODE is enabled
 * Prevents 401/403 errors in development
 */

const DEV_MODE = true; // Match AuthContext.tsx setting

// Mock data storage for dev mode
const mockDatabase: Record<string, any[]> = {
  profiles: [
    {
      id: "59b502b0-7206-4124-86f0-9ed082428869",
      name: "Bulbul (Developer)",
      email: "bulbul@dev.local",
      phone: "+1234567890",
      employee_number: "DEV001",
      is_active: true,
      username: "bulbul_dev",
      created_at: "2025-12-23T11:37:10.628892",
      updated_at: "2025-12-23T11:37:10.628892",
    },
  ],
  attendance_logs: [],
};

// Generate UUID for new records
function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type QueryBuilder = {
  eq: (col: string, val: any) => QueryBuilder;
  select: (cols?: string) => QueryBuilder;
  insert: (data: any[]) => QueryBuilder;
  update: (data: any) => QueryBuilder;
  delete: () => QueryBuilder;
  single: () => QueryBuilder;
  maybeSingle: () => QueryBuilder;
  order: (col: string, opts?: any) => QueryBuilder;
  then: (onFulfilled: any, onRejected?: any) => Promise<any>;
  catch: (onRejected: any) => QueryBuilder;
  _table: string;
  _filters: Array<{ column: string; value: any }>;
  _data?: any;
  _operation?: string;
  _options?: { ascending?: boolean } | string;
  _execType?: string;
  execute: () => Promise<any>;
};

function createQueryBuilder(table: string): QueryBuilder {
  const builder: any = {
    _table: table,
    _filters: [],
    _operation: "select",
    _execType: "multi",

    eq(col: string, val: any) {
      this._filters.push({ column: col, value: val });
      return this;
    },

    select(cols?: string) {
      return this;
    },

    insert(data: any[]) {
      this._operation = "insert";
      this._data = data;
      return this;
    },

    update(data: any) {
      this._operation = "update";
      this._data = data;
      return this;
    },

    delete() {
      this._operation = "delete";
      return this;
    },

    single() {
      this._execType = "single";
      return this;
    },

    maybeSingle() {
      this._execType = "maybe";
      return this;
    },

    order(col: string, opts?: any) {
      this._options = opts || {};
      return this;
    },

    execute() {
      return executeMockQuery(this);
    },

    then(onFulfilled: any, onRejected?: any) {
      return this.execute().then(onFulfilled, onRejected);
    },

    catch(onRejected: any) {
      return this.execute().catch(onRejected);
    },
  };

  return builder;
}

async function executeMockQuery(builder: any): Promise<any> {
  if (!DEV_MODE) {
    return { data: null, error: { message: "Not in dev mode" } };
  }

  const table = builder._table;
  let tableData = mockDatabase[table] || [];

  try {
    switch (builder._operation) {
      case "select": {
        // Apply filters
        let result = tableData;
        for (const filter of builder._filters) {
          result = result.filter((row) => row[filter.column] === filter.value);
        }

        // Apply ordering if specified
        if (builder._options && builder._options.ascending !== undefined) {
          const colName = Object.keys(builder._options)[0];
          if (colName && colName !== "ascending") {
            result.sort((a, b) =>
              builder._options.ascending
                ? a[colName] > b[colName]
                  ? 1
                  : -1
                : a[colName] < b[colName]
                  ? 1
                  : -1,
            );
          }
        }

        // Handle single/maybe
        if (builder._execType === "single") {
          return {
            data: result.length > 0 ? result[0] : null,
            error: result.length === 0 ? { message: "No data" } : null,
          };
        } else if (builder._execType === "maybe") {
          return {
            data: result.length > 0 ? result[0] : null,
            error: null,
          };
        }

        return { data: result, error: null };
      }

      case "insert": {
        const newRecords = builder._data.map((record: any) => ({
          ...record,
          id: record.id || generateId(),
          created_at: record.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        mockDatabase[table].push(...newRecords);

        if (builder._execType === "single") {
          return {
            data: newRecords[0],
            error: null,
          };
        }
        return { data: newRecords, error: null };
      }

      case "update": {
        let updated = false;
        for (const filter of builder._filters) {
          const idx = tableData.findIndex(
            (row) => row[filter.column] === filter.value,
          );
          if (idx >= 0) {
            tableData[idx] = {
              ...tableData[idx],
              ...builder._data,
              updated_at: new Date().toISOString(),
            };
            updated = true;
          }
        }

        return {
          data: updated ? [] : null,
          error: updated ? null : { message: "No rows updated" },
        };
      }

      case "delete": {
        const initialLength = tableData.length;
        mockDatabase[table] = tableData.filter((row) => {
          for (const filter of builder._filters) {
            if (row[filter.column] !== filter.value) return true;
          }
          return false;
        });

        return {
          data: mockDatabase[table].length < initialLength ? [] : null,
          error: null,
        };
      }

      default:
        return { data: null, error: { message: "Unknown operation" } };
    }
  } catch (err: any) {
    return { data: null, error: err };
  }
}

// Export proxy methods
export const supabaseDevProxy = {
  from(table: string) {
    return createQueryBuilder(table);
  },

  getMockData(table: string) {
    return mockDatabase[table] || [];
  },

  setMockData(table: string, data: any[]) {
    mockDatabase[table] = data;
  },

  clearMockData() {
    for (const key in mockDatabase) {
      if (key !== "profiles") {
        mockDatabase[key] = [];
      }
    }
  },
};

export default supabaseDevProxy;
