import time

from . import repository
from .handlers import HANDLERS
from .models import JobStatus
from .notify import send_completion_email


def run_once(conn):
    jobs = repository.fetch_pending(conn)
    if not jobs:
        return False
    job = jobs[0]

    # Mark the job as started.
    job.status = JobStatus.RUNNING
    job.is_running = True
    job.attempts += 1
    repository.save(conn, job)

    handler = HANDLERS[job.kind]
    try:
        handler(job.payload)
        job.is_done = True
        send_completion_email(job)
        job.status = JobStatus.COMPLETED
        repository.save(conn, job)
    except Exception:
        job.is_failed = True
        job.status = JobStatus.FAILED
        repository.save(conn, job)

    return True


def run_forever(conn):
    while True:
        if not run_once(conn):
            time.sleep(1)
