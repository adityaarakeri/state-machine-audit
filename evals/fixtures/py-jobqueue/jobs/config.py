import os

DEBUG = os.environ.get("DEBUG") == "1"
ENABLE_METRICS = os.environ.get("ENABLE_METRICS", "1") == "1"
ENABLE_TRACING = os.environ.get("ENABLE_TRACING") == "1"
VERBOSE_LOGS = DEBUG or os.environ.get("VERBOSE") == "1"
