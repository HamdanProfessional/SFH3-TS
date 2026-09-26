let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent) => {
  const ms = Number(e.data) || 33;
  if (timer !== null) clearInterval(timer);
  timer = setInterval(() => (self as unknown as Worker).postMessage(0), ms);
};
