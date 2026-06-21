// Phase-2 TS port of the Index (src/dd_agent/index.py): SQLite(WAL) state-DB + content-addressed
// artifact store, on bun:sqlite. Faithful 1:1 — same schema, same SQL, same method surface. Time
// values are epoch SECONDS (Date.now()/1000) to match Python's time.time(). Sync API (bun:sqlite
// + node:fs are sync), mirroring the Python class. See docs/bun-migration-eval.md Phase 2.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 1;

const now = () => Date.now() / 1000; // epoch seconds, like Python time.time()

export interface StageState {
  stage: string;
  status: string;
  attempts: number;
}

export interface CampaignSummary {
  campaign: string;
  disease: string | null;
  title: string | null;
  stages: number;
  done: number;
  exhausted: number;
  updated_at: number | null;
}

export class Index {
  artifactsRoot: string;
  db: Database;

  constructor(dbPath: string, artifactsRoot: string) {
    this.artifactsRoot = artifactsRoot;
    mkdirSync(dirname(dbPath) || ".", { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS stage_state(
          campaign     TEXT NOT NULL,
          stage        TEXT NOT NULL,
          status       TEXT NOT NULL,
          attempts     INTEGER NOT NULL DEFAULT 0,
          output_json  TEXT,
          verdict_json TEXT,
          updated_at   REAL,
          PRIMARY KEY (campaign, stage)
      );
      CREATE TABLE IF NOT EXISTS campaigns(
          campaign   TEXT PRIMARY KEY,
          disease    TEXT,
          title      TEXT,
          created_at REAL
      );
      CREATE TABLE IF NOT EXISTS jobs(
          campaign   TEXT NOT NULL,
          key        TEXT NOT NULL,
          jobid      TEXT,
          status     TEXT,
          updated_at REAL,
          PRIMARY KEY (campaign, key)
      );
    `);
    const cols = (this.db.query("PRAGMA table_info(campaigns)").all() as { name: string }[]).map((r) => r.name);
    if (!cols.includes("title")) this.db.exec("ALTER TABLE campaigns ADD COLUMN title TEXT");
    const cur = this.db.query("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | null;
    if (cur == null) {
      this.db.query("INSERT INTO meta(key, value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
    }
  }

  // ---- stage state ----
  status(campaign: string, stage: string): string | null {
    const r = this.db.query("SELECT status FROM stage_state WHERE campaign=? AND stage=?").get(campaign, stage) as
      | { status: string }
      | null;
    return r ? r.status : null;
  }

  isDone(campaign: string, stage: string): boolean {
    return this.status(campaign, stage) === "done";
  }

  attempts(campaign: string, stage: string): number {
    const r = this.db.query("SELECT attempts FROM stage_state WHERE campaign=? AND stage=?").get(campaign, stage) as
      | { attempts: number }
      | null;
    return r ? r.attempts : 0;
  }

  recordAttempt(campaign: string, stage: string): void {
    const t = now();
    this.db
      .query(
        `INSERT INTO stage_state(campaign, stage, status, attempts, updated_at)
         VALUES(?,?,?,1,?)
         ON CONFLICT(campaign, stage) DO UPDATE SET
             attempts = attempts + 1, status='in_progress', updated_at=?`,
      )
      .run(campaign, stage, "in_progress", t, t);
  }

  markDone(campaign: string, stage: string, output: unknown, verdict: unknown): void {
    this.db
      .query(
        `UPDATE stage_state SET status='done', output_json=?, verdict_json=?, updated_at=?
         WHERE campaign=? AND stage=?`,
      )
      .run(JSON.stringify(output), JSON.stringify(verdict), now(), campaign, stage);
  }

  markExhausted(campaign: string, stage: string, reason?: string | null): void {
    if (reason) {
      this.db
        .query("UPDATE stage_state SET status='exhausted', output_json=?, updated_at=? WHERE campaign=? AND stage=?")
        .run(JSON.stringify({ rejected: reason }), now(), campaign, stage);
    } else {
      this.db
        .query("UPDATE stage_state SET status='exhausted', updated_at=? WHERE campaign=? AND stage=?")
        .run(now(), campaign, stage);
    }
  }

  output(campaign: string, stage: string): unknown | null {
    const r = this.db.query("SELECT output_json FROM stage_state WHERE campaign=? AND stage=?").get(campaign, stage) as
      | { output_json: string | null }
      | null;
    return r && r.output_json ? JSON.parse(r.output_json) : null;
  }

  allStates(campaign: string): StageState[] {
    return this.db
      .query("SELECT stage, status, attempts FROM stage_state WHERE campaign=? ORDER BY rowid")
      .all(campaign) as StageState[];
  }

  verdict(campaign: string, stage: string): unknown | null {
    const r = this.db.query("SELECT verdict_json FROM stage_state WHERE campaign=? AND stage=?").get(campaign, stage) as
      | { verdict_json: string | null }
      | null;
    return r && r.verdict_json ? JSON.parse(r.verdict_json) : null;
  }

  stageUpdatedAt(campaign: string, stage: string): number | null {
    const r = this.db.query("SELECT updated_at FROM stage_state WHERE campaign=? AND stage=?").get(campaign, stage) as
      | { updated_at: number }
      | null;
    return r ? r.updated_at : null;
  }

  recordCampaign(campaign: string, disease: string): void {
    this.db
      .query(
        `INSERT INTO campaigns(campaign, disease, created_at) VALUES(?,?,?)
         ON CONFLICT(campaign) DO UPDATE SET disease=excluded.disease`,
      )
      .run(campaign, disease, now());
  }

  campaignExists(campaign: string): boolean {
    return this.db.query("SELECT 1 FROM campaigns WHERE campaign=?").get(campaign) != null;
  }

  renameCampaign(campaign: string, title: string): void {
    this.db
      .query(
        `INSERT INTO campaigns(campaign, title, created_at) VALUES(?,?,?)
         ON CONFLICT(campaign) DO UPDATE SET title=excluded.title`,
      )
      .run(campaign, title, now());
  }

  deleteCampaign(campaign: string): void {
    this.db.query("DELETE FROM stage_state WHERE campaign=?").run(campaign);
    this.db.query("DELETE FROM campaigns WHERE campaign=?").run(campaign);
    this.db.query("DELETE FROM jobs WHERE campaign=?").run(campaign);
  }

  listCampaigns(): CampaignSummary[] {
    const meta = new Map<string, [string | null, string | null]>();
    for (const r of this.db.query("SELECT campaign, disease, title FROM campaigns").all() as {
      campaign: string;
      disease: string | null;
      title: string | null;
    }[]) {
      meta.set(r.campaign, [r.disease, r.title]);
    }
    const agg = new Map<string, [number, number, number, number | null]>();
    for (const r of this.db
      .query(
        `SELECT campaign, COUNT(*) AS s, SUM(status='done') AS d,
                SUM(status='exhausted') AS e, MAX(updated_at) AS u
         FROM stage_state GROUP BY campaign`,
      )
      .all() as { campaign: string; s: number; d: number | null; e: number | null; u: number | null }[]) {
      agg.set(r.campaign, [r.s, r.d ?? 0, r.e ?? 0, r.u]);
    }
    const out: CampaignSummary[] = [];
    for (const c of new Set([...meta.keys(), ...agg.keys()])) {
      const [s, d, e, u] = agg.get(c) ?? [0, 0, 0, null];
      const [disease, title] = meta.get(c) ?? [null, null];
      out.push({ campaign: c, disease, title, stages: s, done: d || 0, exhausted: e || 0, updated_at: u });
    }
    out.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    return out;
  }

  // ---- content-addressed artifact store ----
  writeArtifact(campaign: string, name: string, data: string, subdir = "01_discovery"): string {
    const h = createHash("sha256").update(data).digest("hex").slice(0, 12);
    const d = join(this.artifactsRoot, campaign, subdir);
    mkdirSync(d, { recursive: true });
    const path = join(d, `${name}-${h}.json`);
    const tmp = path + ".tmp";
    writeFileSync(tmp, data, "utf-8"); // atomic: write tmp then rename
    renameSync(tmp, path);
    return path;
  }

  // ---- long-job idempotency hook ----
  getJob(campaign: string, key: string): string | null {
    const r = this.db.query("SELECT jobid FROM jobs WHERE campaign=? AND key=?").get(campaign, key) as
      | { jobid: string | null }
      | null;
    return r ? r.jobid : null;
  }

  putJob(campaign: string, key: string, jobid: string, status = "submitted"): void {
    const t = now();
    this.db
      .query(
        `INSERT INTO jobs(campaign, key, jobid, status, updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(campaign, key) DO UPDATE SET jobid=?, status=?, updated_at=?`,
      )
      .run(campaign, key, jobid, status, t, jobid, status, t);
  }

  // exposed for tests/cleanliness; harmless if existsSync(path) needed by callers
  static fileExists(path: string): boolean {
    return existsSync(path);
  }

  close(): void {
    this.db.close();
  }
}
