// Tiny health endpoint for the worker/reaper (спец §2.2).
//
// No web framework — a single http.createServer on /health (port 8080) for
// Docker healthcheck / k8s liveness. 200 when the process reports healthy.

import http from "node:http";

export interface HealthServer {
  server: http.Server;
  close: () => Promise<void>;
}

export function startHealthServer(
  port: number,
  isHealthy: () => boolean,
): HealthServer {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      const ok = isHealthy();
      res.writeHead(ok ? 200 : 503, { "Content-Type": "text/plain" });
      res.end(ok ? "ok" : "unhealthy");
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port);
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
