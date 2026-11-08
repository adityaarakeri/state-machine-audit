export const analytics = {
  track(event: string, props: Record<string, unknown>) {
    navigator.sendBeacon("/collect", JSON.stringify({ event, props }));
  },
};
