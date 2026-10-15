"use strict";
/**
 * Turns the launcher input into a fully qualified URL.
 *
 * @param {string} input User input.
 * @param {string} template Search query template containing "%s".
 * @returns {string} URL to load through the proxy.
 */
function search(input, template) {
	// Already a valid URL: https://example.com/test?q=param
	try {
		return new URL(input).toString();
	} catch {
		// Not a valid URL, keep going.
	}

	// Valid once http:// is prepended (and the host has a dot).
	try {
		const url = new URL(`http://${input}`);
		if (url.hostname.includes(".")) return url.toString();
	} catch {
		// Not a host either, treat it as a search query.
	}

	return template.replace("%s", encodeURIComponent(input));
}
