// Testcontainers helpers for the agent-loop integration tests.
//
// Gated callers should check RUN_CONTAINER_TESTS=1 before invoking these —
// they require a reachable Docker daemon. This mirrors the existing
// RUN_DB_TESTS / RUN_DOCKER_TESTS convention so the default `npm test`
// stays Docker-independent and green.

import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import Redis from "ioredis";

export interface StartedPostgres {
  url: string;
  host: string;
  port: number;
  container: StartedTestContainer;
  stop: () => Promise<void>;
}

/** Start a throwaway postgres:16-alpine container and return a connection URL. */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(
        /database system is ready to accept connections/,
        2,
      ),
    )
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return {
    url: `postgres://test:test@${host}:${port}/test`,
    host,
    port,
    container,
    stop: async () => {
      await container.stop();
    },
  };
}

export interface StartedRedis {
  url: string;
  host: string;
  port: number;
  container: StartedTestContainer;
  /** Plain client for inspection (NOT in subscribe mode). */
  inspector: Redis;
  /** Make a fresh ioredis client bound to this container. */
  client: () => Redis;
  stop: () => Promise<void>;
}

/**
 * Start a throwaway redis:7-alpine container with the production-relevant
 * flags (noeviction + AOF) and return connection helpers.
 */
export async function startRedis(): Promise<StartedRedis> {
  const container = await new GenericContainer("redis:7-alpine")
    .withCommand([
      "redis-server",
      "--maxmemory-policy",
      "noeviction",
      "--appendonly",
      "yes",
    ])
    .withExposedPorts(6379)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(6379);
  const url = `redis://${host}:${port}`;
  const clients: Redis[] = [];
  const client = (): Redis => {
    const c = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    clients.push(c);
    return c;
  };
  const inspector = client();

  return {
    url,
    host,
    port,
    container,
    inspector,
    client,
    stop: async () => {
      for (const c of clients) {
        try {
          c.disconnect();
        } catch {
          /* ignore */
        }
      }
      await container.stop();
    },
  };
}

/** Read a ReadableStream<string> fully into an array of chunks. */
export async function readAllChunks(
  stream: ReadableStream<string>,
): Promise<string[]> {
  const reader = stream.getReader();
  const out: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) out.push(value);
  }
  return out;
}

/**
 * A TransformStream that delays each chunk by `ms`, keeping a producer stream
 * "in progress" long enough for resumable-stream to hand back a live consumer
 * view (a fully-synchronous source drains to DONE before createNewResumableStream
 * can return one).
 */
export function delayTransform<T>(ms: number): TransformStream<T, T> {
  return new TransformStream<T, T>({
    async transform(chunk, controller) {
      await new Promise((r) => setTimeout(r, ms));
      controller.enqueue(chunk);
    },
  });
}

/** Build a ReadableStream<string> from chunks, optionally with a per-chunk delay. */
export function makeStringStream(
  chunks: string[],
  delayMs = 0,
): ReadableStream<string> {
  let i = 0;
  return new ReadableStream<string>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      controller.enqueue(chunks[i++]);
    },
  });
}

/**
 * Parse a concatenated SSE string back into the JSON chunk objects it carried.
 * `JsonToSseTransformStream` emits `data: {json}\n\n` per chunk (and a final
 * `data: [DONE]`). resumable-stream may re-chunk the byte boundaries, so we
 * join everything and split on the SSE record separator.
 */
export function parseSseChunks(raw: string): Array<Record<string, unknown>> {
  const records = raw.split("\n\n");
  const out: Array<Record<string, unknown>> = [];
  for (const rec of records) {
    const line = rec
      .split("\n")
      .find((l) => l.startsWith("data: "));
    if (!line) continue;
    const payload = line.slice("data: ".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    out.push(JSON.parse(payload) as Record<string, unknown>);
  }
  return out;
}
