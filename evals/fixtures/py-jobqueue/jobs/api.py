from . import repository
from .models import JobStatus


def cancel_job(conn, job_id: int):
    conn.execute("UPDATE jobs SET status = 'cancelled' WHERE id = ?", (job_id,))
    conn.commit()
    return {"ok": True}


def retry_job(conn, job_id: int):
    conn.execute("UPDATE jobs SET status = 'pending', attempts = 0 WHERE id = ?", (job_id,))
    conn.commit()
    return {"ok": True}


def job_label(status: str) -> str:
    labels = {
        JobStatus.PENDING: "Waiting",
        JobStatus.RUNNING: "In progress",
        JobStatus.COMPLETED: "Done",
        JobStatus.FAILED: "Failed",
    }
    return labels[status]
