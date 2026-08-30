// Minimal in-memory stand-in for the subset of supabase-js's query builder
// that lib/telegram/publishing-service.ts and webhook-service.ts use. Real
// Postgres semantics we specifically emulate: unique-constraint-style
// dedup for `upsert(..., { ignoreDuplicates: true })` keyed by onConflict
// columns, and `.maybeSingle()` returning null instead of erroring.
type Row = Record<string, unknown>;

export class TestDb {
  tables = new Map<string, Row[]>();

  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows.map((r) => ({ ...r })));
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
}

type Filter = { field: string; op: "eq" | "in" | "not.is" | "lte" | "gte"; value: unknown };

class QueryBuilder implements PromiseLike<{ data: Row[] | Row | null; error: null; count?: number }> {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private patch: Row | Row[] = {};
  private wantSingle: "single" | "maybeSingle" | null = null;
  private limitN: number | null = null;

  constructor(private db: TestDb, private table: string) {}

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, op: "eq", value });
    return this;
  }

  in(field: string, value: unknown[]) {
    this.filters.push({ field, op: "in", value });
    return this;
  }

  not(field: string, _cmp: string, value: unknown) {
    this.filters.push({ field, op: "not.is", value });
    return this;
  }

  lte(field: string, value: unknown) {
    this.filters.push({ field, op: "lte", value });
    return this;
  }

  gte(field: string, value: unknown) {
    this.filters.push({ field, op: "gte", value });
    return this;
  }

  order() {
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.patch = rows;
    return this;
  }

  // Real signature takes an onConflict/ignoreDuplicates options object; the
  // fake only ever emulates ignoreDuplicates behavior (see rowConflicts()).
  upsert(rows: Row[]) {
    this.mode = "upsert";
    this.patch = rows;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  single() {
    this.wantSingle = "single";
    return this;
  }

  maybeSingle() {
    this.wantSingle = "maybeSingle";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const actual = row[f.field];
      if (f.op === "eq") return actual === f.value;
      if (f.op === "in") return (f.value as unknown[]).includes(actual);
      if (f.op === "not.is") return actual !== null && actual !== undefined;
      if (f.op === "lte") return String(actual) <= String(f.value);
      if (f.op === "gte") return String(actual) >= String(f.value);
      return true;
    });
  }

  private execute(): { data: Row[] | Row | null; error: null } {
    const all = this.db.rows(this.table);

    if (this.mode === "insert") {
      const toInsert = Array.isArray(this.patch) ? this.patch : [this.patch];
      const inserted = toInsert.map((r) => ({ id: r.id ?? crypto.randomUUID(), ...r }));
      all.push(...inserted);
      return { data: this.wantSingle ? inserted[0] : inserted, error: null };
    }

    if (this.mode === "upsert") {
      const toUpsert = Array.isArray(this.patch) ? this.patch : [this.patch];
      const results: Row[] = [];
      for (const row of toUpsert) {
        const dup = all.find((existing) => this.filters.length === 0 && rowConflicts(existing, row));
        if (dup) continue; // ignoreDuplicates behavior
        const inserted = { id: row.id ?? crypto.randomUUID(), ...row };
        all.push(inserted);
        results.push(inserted);
      }
      return { data: results, error: null };
    }

    const matched = all.filter((row) => this.matches(row));

    if (this.mode === "update") {
      for (const row of matched) Object.assign(row, this.patch);
      return { data: this.wantSingle ? matched[0] ?? null : matched, error: null };
    }

    if (this.mode === "delete") {
      const remaining = all.filter((row) => !this.matches(row));
      this.db.tables.set(this.table, remaining);
      return { data: matched, error: null };
    }

    const limited = this.limitN !== null ? matched.slice(0, this.limitN) : matched;

    if (this.wantSingle === "single") {
      return { data: limited[0] ?? null, error: null };
    }
    if (this.wantSingle === "maybeSingle") {
      return { data: limited[0] ?? null, error: null };
    }

    return { data: limited, error: null };
  }

  then<TResult1 = { data: Row[] | Row | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

// Two rows "conflict" (for upsert dedup) if they share the same values for
// every key present in the new row that also exists on the existing row —
// good enough to emulate a unique(post_id, channel_id) constraint in tests.
function rowConflicts(existing: Row, incoming: Row): boolean {
  const keys = ["post_id", "channel_id"].filter((k) => k in incoming);
  if (keys.length === 0) return false;
  return keys.every((k) => existing[k] === incoming[k]);
}

export function makeTestSupabase(db: TestDb) {
  return {
    from(table: string) {
      return new QueryBuilder(db, table);
    },
  };
}
