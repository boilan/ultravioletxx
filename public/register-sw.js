"use strict";
/**
 * Registers the stock Ultraviolet service worker.
 * The worker lives under /uv/, so its default scope (/uv/) already covers
 * the proxied path prefix (/uv/service/).
 */
const stockSW = "/uv/sw.js";

/** Hostnames allowed to register service workers over plain http. */
const swAllowedHostnames = ["localhost", "127.0.0.1", "::1"];

async function registerSW() {
	if (!navigator.serviceWorker) {
		if (
			location.protocol !== "https:" &&
			!swAllowedHostnames.includes(location.hostname)
		) {
			throw new Error("Service workers cannot be registered without https.");
		}

		throw new Error("Your browser doesn't support service workers.");
	}

	return navigator.serviceWorker.register(stockSW);
}

/**
 * Resolves once the returned registration has an activated worker, so that
 * the first proxied navigation is guaranteed to be intercepted.
 */
async function waitForActivation(registration) {
	if (registration.active) return registration;

	const worker = registration.installing || registration.waiting;
	if (!worker) throw new Error("Service worker installation failed.");

	await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Timed out waiting for the service worker.")),
			15000,
		);

		worker.addEventListener("statechange", () => {
			if (worker.state === "activated") {
				clearTimeout(timer);
				resolve();
			} else if (worker.state === "redundant") {
				clearTimeout(timer);
				reject(new Error("Service worker installation failed."));
			}
		});
	});

	return registration;
}
