let timer: ReturnType<typeof setInterval> | undefined;

export function startNotificationPolling(onMessage: (m: string[]) => void) {
  timer = setInterval(async () => {
    const res = await fetch("/api/notifications", {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (res.status === 401) {
      console.warn("notifications: unauthorized, will retry");
      return;
    }
    onMessage(await res.json());
  }, 5000);
}
