/**
 * Smoke test for the production server.
 *
 * Boots server/index.js on a free port and verifies:
 *   1. the launcher, Ultraviolet assets, bare-mux assets and the Bare
 *      transport client are served with the right content types,
 *   2. public/uv/uv.config.js wins over the stock dist config,
 *   3. the COOP/COEP isolation headers are set,
 *   4. unknown paths 404,
 *   5. the Bare v3 HTTP relay really fetches a remote site,
 *   6. the Bare v3 WebSocket relay really tunnels a remote socket.
 *
 * Points 5 and 6 need outbound network access; everything else is local.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE_HTTP = "https://example.com/";
const REMOTE_WS = "wss://ws.postman-echo.com/raw";

const STATIC_ASSETS = [
	["/", "text/html"],
	["/healthz", "text/plain"],
	["/style.css", "text/css"],
	["/register-sw.js", "text/javascript"],
	["/uv/sw.js", "text/javascript"],
	["/uv/uv.bundle.js", "text/javascript"],
	["/uv/uv.handler.js", "text/javascript"],
	["/baremux/index.js", "text/javascript"],
	["/baremux/worker.js", "text/javascript"],
	["/bare-client/index.mjs", "text/javascript"],
];

let failures = 0;

function report(name, detail) {
	failures += 1;
	console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(name, fn) {
	try {
		await fn();
		console.log(`  ok   ${name}`);
	} catch (err) {
		report(name, err.message);
	}
}

function freePort() {
	return new Promise((resolvePort, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolvePort(port));
		});
	});
}

async function waitFor(url, attempts = 100) {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// Server not accepting connections yet.
		}
		await sleep(100);
	}
	throw new Error(`server did not answer ${url}`);
}

async function main() {
	const port = await freePort();
	const origin = `http://127.0.0.1:${port}`;

	const server = spawn(process.execPath, [resolve(root, "server", "index.js")], {
		cwd: root,
		env: { ...process.env, PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});

	let serverLog = "";
	server.stdout.on("data", (chunk) => (serverLog += chunk));
	server.stderr.on("data", (chunk) => (serverLog += chunk));

	console.log(`smoke: server on ${origin} (pid ${server.pid})`);

	try {
		await waitFor(`${origin}/healthz`);

		console.log("static assets");
		for (const [path, type] of STATIC_ASSETS) {
			await check(`GET ${path} → 200 ${type}`, async () => {
				const res = await fetch(origin + path);
				assert.equal(res.status, 200, `status ${res.status}`);
				assert.match(
					res.headers.get("content-type") ?? "",
					new RegExp(type),
					`content-type ${res.headers.get("content-type")}`,
				);
			});
		}

		await check("uv.config.js override points at /uv/", async () => {
			const body = await (await fetch(`${origin}/uv/uv.config.js`)).text();
			assert.match(body, /prefix:\s*"\/uv\/service\/"/);
		});

		await check("unknown path returns 404", async () => {
			const res = await fetch(`${origin}/definitely-not-here`);
			assert.equal(res.status, 404);
		});

		await check("cross-origin isolation headers", async () => {
			const res = await fetch(`${origin}/`);
			assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin");
			assert.equal(
				res.headers.get("cross-origin-embedder-policy"),
				"require-corp",
			);
		});

		console.log("bare relay");
		await check(`Bare v3 HTTP relay fetches ${REMOTE_HTTP}`, async () => {
			const res = await fetch(`${origin}/bare/v3/?cache=smoke`, {
				headers: {
					"x-bare-url": REMOTE_HTTP,
					"x-bare-headers": JSON.stringify({
						host: new URL(REMOTE_HTTP).host,
						accept: "*/*",
					}),
				},
			});
			assert.equal(res.status, 200, `status ${res.status}`);
			assert.equal(res.headers.get("x-bare-status"), "200");
			const body = await res.text();
			assert.match(body, /<html/i, "empty or unexpected body");
		});

		await check(`Bare v3 WebSocket relay tunnels ${REMOTE_WS}`, async () => {
			const socket = new WebSocket(`${origin.replace("http", "ws")}/bare/v3/`, [
				"bare",
			]);
			try {
				await new Promise((res, rej) => {
					socket.once("open", res);
					socket.once("error", rej);
					setTimeout(() => rej(new Error("ws handshake timeout")), 15000);
				});

				socket.send(
					JSON.stringify({
						type: "connect",
						remote: REMOTE_WS,
						// Empty list: the echo endpoint answers no subprotocol and the
						// ws client rejects requesting one that is not returned.
						protocols: [],
						// The Bare client supplies these itself; without Host the
						// remote rejects the upgrade (the server sets setHost: false).
						headers: {
							Host: new URL(REMOTE_WS).host,
							Upgrade: "websocket",
							Connection: "Upgrade",
						},
						forwardHeaders: [],
					}),
				);

				const first = await new Promise((res, rej) => {
					socket.once("message", (data) => res(data.toString()));
					socket.once("error", rej);
					setTimeout(() => rej(new Error("no connect reply")), 15000);
				});

				const handshake = JSON.parse(first);
				assert.equal(handshake.type, "open", `unexpected reply: ${first}`);

				socket.send("smoke-ping");
				const echoed = await new Promise((res, rej) => {
					socket.once("message", (data) => res(data.toString()));
					socket.once("error", rej);
					setTimeout(() => rej(new Error("no echo")), 15000);
				});
				assert.equal(echoed, "smoke-ping", `echoed: ${echoed}`);
			} finally {
				socket.close();
			}
		});
	} catch (err) {
		report("server startup", err.message);
	} finally {
		server.kill();
	}

	if (failures > 0 && serverLog.trim()) {
		console.error("--- server log ---");
		console.error(serverLog.trim());
		console.error("------------------");
	}

	if (failures > 0) {
		console.error(`\nsmoke: ${failures} check(s) failed`);
		process.exit(1);
	}

	console.log("\nsmoke: all checks passed");
	process.exit(0);
}

main();
