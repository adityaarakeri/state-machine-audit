from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Job:
    id: int
    kind: str
    payload: dict
    status: JobStatus = JobStatus.PENDING
    attempts: int = 0
    is_running: bool = False
    is_done: bool = False
    is_failed: bool = False
    updated_at: datetime = field(default_factory=datetime.utcnow)
