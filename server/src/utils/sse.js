/**
 * Puts a response into Server-Sent Events mode and returns a `send(payload)`
 * that writes one JSON frame. `X-Accel-Buffering: no` stops nginx-style proxies
 * (Render's included) from buffering the stream into one lump at the end.
 */
export function openSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  return function send(payload) {
    if (closed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
}
