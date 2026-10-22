// Starts the app on a random port for tests.
import { createServer, type RequestListener, type Server } from "node:http";
import { createAuth } from "@openasy/auth";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "./app.ts";
import { openDb } from "./db.ts";
import { createRisk } from "./risk.ts";

export const ADMIN_TOKEN = "test-admin-token";

/** A clock the tests move. */
export function fakeClock(start = "2026-10-22T09:00:00Z") {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (days: number) => void (t += days * 86_400_000) };
}

export async function startApp(opts: Partial<AppOptions> & { version: string; clock?: ReturnType<typeof fakeClock> }) {
  const db = openDb(":memory:");
  const clock = opts.clock ?? fakeClock();
  const risk = createRisk(db, { now: clock.now });
  // The origin is known once the port is, so the handler is set after listening.
  let handler: RequestListener = (_req, res) => res.writeHead(503).end();
  const server: Server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const auth = createAuth({ db, product: "risk", productName: "OpenAsy Risk", origin: base });
  const { clock: _clock, ...rest } = opts;
  handler = createApp({ db, risk, auth, adminToken: ADMIN_TOKEN, ...rest });
  const admin = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", ...init.headers } });
  const send = (method: string, path: string, body?: unknown) => admin(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { db, risk, auth, base, admin, send, close, clock };
}
