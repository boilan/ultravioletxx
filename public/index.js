"use strict";
/**
 * Ultraviolet launcher.
 *
 * Keeps this page open while the proxied site runs in the iframe: the
 * service worker borrows the bare-mux transport from a live window client,
 * so the launcher must outlive the proxied document.
 */
const BARE_TRANSPORT = "/bare-client/index.mjs";

/** @type {HTMLFormElement} */
const form = document.getElementById("uv-form");
/** @type {HTMLInputElement} */
const address = document.getElementById("uv-address");
/** @type {HTMLInputElement} */
const searchEngine = document.getElementById("uv-search-engine");
/** @type {HTMLIFrameElement} */
const frame = document.getElementById("uv-frame");
const errorWrap = document.getElementById("uv-error-wrap");
const error = document.getElementById("uv-error");
const errorCode = document.getElementById("uv-error-code");

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

function showError(message, err) {
	errorWrap.hidden = false;
	error.textContent = message;
	errorCode.textContent = err ? String(err) : "";
}

async function prepareProxy() {
	const registration = await waitForActivation(await registerSW());

	if ((await connection.getTransport()) !== BARE_TRANSPORT) {
		// Absolute URL: the transport runs inside a worker, where a bare
		// path such as "/bare/" cannot be resolved on its own.
		await connection.setTransport(BARE_TRANSPORT, [
			`${location.origin}/bare/`,
		]);
	}

	return registration;
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	errorWrap.hidden = true;

	try {
		await prepareProxy();
	} catch (err) {
		showError("Failed to start the proxy.", err);
		return;
	}

	const url = search(address.value, searchEngine.value);
	frame.style.display = "block";
	frame.src = __uv$config.prefix + __uv$config.encodeUrl(url);
});
