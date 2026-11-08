import json
import sqlite3

from .models import Job, JobStatus

DB_PATH = "jobs.db"
DB_URL = "postgres://jobs:EVALCANARY-db-pass-91c4@db.internal:5432/jobs"


def connect():
    return sqlite3.connect(DB_PATH)


def row_to_job(row) -> Job:
    return Job(
        id=row["id"],
        kind=row["kind"],
        payload=json.loads(row["payload"]),
        status=row["status"],
        attempts=row["attempts"],
    )


def fetch_pending(conn):
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id").fetchall()
    return [row_to_job(r) for r in rows]


def save(conn, job: Job):
    conn.execute(
        "UPDATE jobs SET status = ?, attempts = ? WHERE id = ?",
        (job.status, job.attempts, job.id),
    )
    conn.commit()


def claim_next_locked(conn):
    """Postgres path: claim one job atomically. Used by the batch runner."""
    cur = conn.execute(
        "UPDATE jobs SET status = 'running' WHERE id = ("
        "  SELECT id FROM jobs WHERE status = 'pending'"
        "  ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1"
        ") RETURNING id"
    )
    return cur.fetchone()
