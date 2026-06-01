"""Index = SQLite(WAL) state-DB + content-addressed artifact store.

state-DB / artifact-store SPLIT (adopted from coder-loop sqlite-state.ts,
see REFERENCES + ARCHITECTURE §3.8):
- SQLite holds pipeline/stage state, attempts, run accounting, jobids, idempotency keys.
- content-addressed files hold scientific artifacts (candidates/evidence/structures/...).

durable: state survives process death; Runner skips stages already 'done' on
restart (= (c)-level resume). Long-job idempotency (jobs table) is the (a) hook,
filled when GPU/slurm lands.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from typing import Any

SCHEMA_VERSION = 1


class Index:
    def __init__(self, db_path: str, artifacts_root: str):
        self.artifacts_root = artifacts_root
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        os.makedirs(artifacts_root, exist_ok=True)
        self.db = sqlite3.connect(db_path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def _migrate(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS stage_state(
                campaign     TEXT NOT NULL,
                stage        TEXT NOT NULL,
                status       TEXT NOT NULL,            -- queued|in_progress|done|exhausted
                attempts     INTEGER NOT NULL DEFAULT 0,
                output_json  TEXT,
                verdict_json TEXT,
                updated_at   REAL,
                PRIMARY KEY (campaign, stage)
            );
            -- (a) durable hook for long external jobs (slurm); used when GPU lands.
            CREATE TABLE IF NOT EXISTS jobs(
                campaign   TEXT NOT NULL,
                key        TEXT NOT NULL,              -- idempotency key = hash(node+tool+params)
                jobid      TEXT,
                status     TEXT,
                updated_at REAL,
                PRIMARY KEY (campaign, key)
            );
            """
        )
        cur = self.db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        if cur is None:
            self.db.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?)", (str(SCHEMA_VERSION),)
            )
        self.db.commit()

    # ---- stage state (durable pipeline progress) ----
    def status(self, campaign: str, stage: str) -> str | None:
        r = self.db.execute(
            "SELECT status FROM stage_state WHERE campaign=? AND stage=?", (campaign, stage)
        ).fetchone()
        return r[0] if r else None

    def is_done(self, campaign: str, stage: str) -> bool:
        return self.status(campaign, stage) == "done"

    def attempts(self, campaign: str, stage: str) -> int:
        r = self.db.execute(
            "SELECT attempts FROM stage_state WHERE campaign=? AND stage=?", (campaign, stage)
        ).fetchone()
        return r[0] if r else 0

    def record_attempt(self, campaign: str, stage: str) -> None:
        now = time.time()
        self.db.execute(
            """INSERT INTO stage_state(campaign, stage, status, attempts, updated_at)
               VALUES(?,?,?,1,?)
               ON CONFLICT(campaign, stage) DO UPDATE SET
                   attempts = attempts + 1, status='in_progress', updated_at=?""",
            (campaign, stage, "in_progress", now, now),
        )
        self.db.commit()

    def mark_done(self, campaign: str, stage: str, output: dict, verdict: dict) -> None:
        self.db.execute(
            """UPDATE stage_state SET status='done', output_json=?, verdict_json=?, updated_at=?
               WHERE campaign=? AND stage=?""",
            (json.dumps(output), json.dumps(verdict), time.time(), campaign, stage),
        )
        self.db.commit()

    def mark_exhausted(self, campaign: str, stage: str) -> None:
        self.db.execute(
            "UPDATE stage_state SET status='exhausted', updated_at=? WHERE campaign=? AND stage=?",
            (time.time(), campaign, stage),
        )
        self.db.commit()

    def output(self, campaign: str, stage: str) -> dict | None:
        r = self.db.execute(
            "SELECT output_json FROM stage_state WHERE campaign=? AND stage=?", (campaign, stage)
        ).fetchone()
        return json.loads(r[0]) if r and r[0] else None

    def all_states(self, campaign: str) -> list[tuple]:
        return self.db.execute(
            "SELECT stage, status, attempts FROM stage_state WHERE campaign=? ORDER BY rowid",
            (campaign,),
        ).fetchall()

    # ---- content-addressed artifact store ----
    def write_artifact(self, campaign: str, name: str, data: str, subdir: str = "01_discovery") -> str:
        h = hashlib.sha256(data.encode()).hexdigest()[:12]
        d = os.path.join(self.artifacts_root, campaign, subdir)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f"{name}-{h}.json")
        tmp = path + ".tmp"
        with open(tmp, "w") as f:        # atomic: write tmp then rename (ARCHITECTURE §3.8)
            f.write(data)
        os.replace(tmp, path)
        return path

    # ---- (a) long-job idempotency hook (used when GPU/slurm lands) ----
    def get_job(self, campaign: str, key: str) -> str | None:
        r = self.db.execute(
            "SELECT jobid FROM jobs WHERE campaign=? AND key=?", (campaign, key)
        ).fetchone()
        return r[0] if r else None

    def put_job(self, campaign: str, key: str, jobid: str, status: str = "submitted") -> None:
        self.db.execute(
            """INSERT INTO jobs(campaign, key, jobid, status, updated_at) VALUES(?,?,?,?,?)
               ON CONFLICT(campaign, key) DO UPDATE SET jobid=?, status=?, updated_at=?""",
            (campaign, key, jobid, status, time.time(), jobid, status, time.time()),
        )
        self.db.commit()

    def close(self) -> None:
        self.db.close()
