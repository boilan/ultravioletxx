/**
 * Production server for the Ultraviolet proxy.
 *
 * Serves:
 *   /                 the launcher frontend (public/)
 *   /uv/              the built Ultraviolet assets (dist/)
 *   /baremux/         bare-mux assets (transport multiplexer)
 *   /bare-client/     the Bare transport client (browser bundle)
 *   /bare/            the Bare server (the relay that actually fetches remote sites)
 *
 * The Bare HTTP endpoint and its WebSocket upgrade are handled by
 * @tomphttp/bare-server-node; everything else falls through to Express.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { createBareServer } from "@tomphttp/bare-server-node";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const publicPath = join(rootDir, "public");
const uvPath = join(rootDir, "dist");
// "@mercuryworkshop/bare-as-module3" resolves to <pkg>/lib/index.cjs,
// so the browser bundle we need lives in <pkg>/dist.
const bareClientPath = join(dirname(require.resolve("@mercuryworkshop/bare-as-module3")), "..", "dist");

const bare = createBareServer("/bare/", { logErrors: true });

const app = express();

app.get("/healthz", (req, res) => {
	res.type("text/plain").send("ok");
});

// Public files are mounted first so public/uv/uv.config.js wins over the
// stock dist/uv.config.js served by the /uv/ mount below.
app.use(express.static(publicPath));
app.use("/uv/", express.static(uvPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/bare-client/", express.static(bareClientPath));

app.use((req, res) => {
	res.status(404).type("text/plain").send("404 Not Found");
});

const server = createServer();

server.on("request", (req, res) => {
	if (bare.shouldRoute(req)) {
		bare.routeRequest(req, res);
		return;
	}
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
	app(req, res);
});

server.on("upgrade", (req, socket, head) => {
	if (bare.shouldRoute(req)) {
		bare.routeUpgrade(req, socket, head);
		return;
	}
	socket.end();
});

const parsedPort = parseInt(process.env.PORT ?? "", 10);
const port = Number.isNaN(parsedPort) ? 8080 : parsedPort;

server.listen(port, () => {
	const address = server.address();
	console.log(`Ultraviolet listening on http://localhost:${address.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("Shutting down: closing HTTP server");
	server.close(() => process.exit(0));
	// Do not hang forever on open proxy connections.
	setTimeout(() => process.exit(0), 3000).unref();
}
