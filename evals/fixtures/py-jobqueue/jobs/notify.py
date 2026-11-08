import smtplib


def send_completion_email(job):
    try:
        with smtplib.SMTP("localhost") as smtp:
            smtp.sendmail("jobs@example.com", job.payload["notify"], f"Job {job.id} done")
    except Exception:
        pass
