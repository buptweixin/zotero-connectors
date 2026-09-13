/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2026

    This file is part of Zotero.

    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public
    License along with Zotero.  If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

/**
 * Duplicate detection for saved items.
 *
 * Primary source: the running Zotero client's read-only local API
 * (http://127.0.0.1:23119/api), which covers the whole library, including
 * items added directly in Zotero. Falls back to a local history of items
 * previously saved through this connector when the client or its local API
 * is not reachable.
 *
 * The client offers no way to modify an existing item through the connector
 * API (and the local API is read-only), so a detected duplicate can only be
 * updated by reusing its original connector save session — the client keeps
 * those for about 10 minutes. Older matches are just revealed in the client
 * via zotero://select. Runs in the background only; the inject side calls
 * check()/checkInLibrary()/remember() via messaging.
 */
Zotero.DuplicateChecker = new function() {
	const HISTORY_PREF = 'duplicateChecker.history';
	const MAX_HISTORY_SIZE = 5000;
	// Read-only local API of the Zotero client; only My Library is searched
	const LOCAL_API_BASE = 'http://127.0.0.1:23119/api/users/0';
	// Mirrors the client's session GC (10 minutes, 1 minute past 10 sessions)
	const SESSION_TTL_MS = 10 * 60 * 1000;
	// Below these lengths a normalized title is too generic to match on
	const MIN_TITLE_LENGTH = 10;
	const MIN_TITLE_LENGTH_CJK = 4;
	const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

	function loadHistory() {
		let history = Zotero.Prefs.get(HISTORY_PREF);
		return Array.isArray(history) ? history : [];
	}

	function saveHistory(history) {
		return Zotero.Prefs.set(HISTORY_PREF, history);
	}

	function normalizeDOI(doi) {
		doi = String(doi || '').trim().toLowerCase()
			.replace(/^(?:https?:)?(?:\/\/)?(?:dx\.)?doi\.org\//, '')
			.replace(/^info:doi\//, '')
			.replace(/^doi:\s*/, '');
		return doi || null;
	}

	function normalizeTitle(title) {
		title = String(title || '').normalize('NFC').toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();
		// CJK text has no word separators, so spaces introduced by removed
		// punctuation would otherwise break matching
		if (CJK_RE.test(title)) {
			title = title.replace(/\s+/gu, '');
		}
		return title || null;
	}

	/**
	 * A matchable fingerprint of an item: DOI when available, otherwise a
	 * normalized title (when long enough to be meaningful). Webpages are
	 * excluded — re-saving the same page as a snapshot is routine.
	 */
	function fingerprint(item) {
		if (!item || item.itemType == 'webpage') return null;
		let doi = normalizeDOI(item.DOI);
		let title = normalizeTitle(item.title);
		if (title) {
			let minLen = CJK_RE.test(title) ? MIN_TITLE_LENGTH_CJK : MIN_TITLE_LENGTH;
			if (title.length < minLen) title = null;
		}
		if (!doi && !title) return null;
		return { doi, title, titleText: item.title || '' };
	}

	function findMatches(fingerprints, history) {
		let byDOI = new Map();
		let byTitle = new Map();
		for (let h of history) {
			if (h.doi) byDOI.set(h.doi, h);
			if (h.title) byTitle.set(h.title, h);
		}
		let matches = [];
		for (let fp of fingerprints) {
			let match = fp.doi ? byDOI.get(fp.doi) : null;
			if (!match && fp.title) match = byTitle.get(fp.title);
			if (match) {
				matches.push({
					title: match.titleText || fp.titleText,
					doi: match.doi || fp.doi,
					savedAt: match.t
				});
			}
		}
		return matches;
	}

	/**
	 * Check translated items against the saved history
	 * @param {Object[]} items - items about to be saved
	 * @returns {Promise<{duplicates: {title: String, doi: String|null, savedAt: Number}[]}>}
	 */
	this.check = function(items) {
		let fingerprints = (items || []).map(fingerprint).filter(Boolean);
		return Promise.resolve({ duplicates: findMatches(fingerprints, loadHistory()) });
	};

	async function apiGet(path) {
		let controller = new AbortController();
		let timer = setTimeout(() => controller.abort(), 8000);
		try {
			let response = await fetch(LOCAL_API_BASE + path, {
				headers: {
					'Zotero-API-Version': '3',
					// The client's local API refuses requests carrying a
					// browser Origin header (DNS-rebinding protection) unless
					// they identify as coming from a Zotero connector
					'X-Zotero-Connector-API-Version': '2'
				}
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return await response.json();
		}
		finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Match one translated item against library items returned by a
	 * ?q= search, preferring an exact DOI match over a normalized-title
	 * match. Returns a match descriptor or null.
	 */
	function matchApiItem(fp, apiItems) {
		let byDOI = null;
		let byTitle = null;
		for (let apiItem of apiItems) {
			let data = apiItem.data || apiItem;
			if (data.itemType == 'note' || data.itemType == 'attachment') continue;
			if (!byDOI && fp.doi) {
				let doi = normalizeDOI(data.DOI);
				if (doi && doi == fp.doi) byDOI = apiItem;
			}
			if (!byTitle && fp.title) {
				let title = normalizeTitle(data.title);
				if (title && title == fp.title) byTitle = apiItem;
			}
			if (byDOI) break;
		}
		return byDOI || byTitle;
	}

	/**
	 * Search the user's library through the client's read-only local API
	 * for items matching the ones about to be saved. Detects items added
	 * directly in Zotero, not just connector saves.
	 *
	 * @param {Object[]} items - items about to be saved
	 * @returns {Promise<{available: Boolean, matches: Object[]}>}
	 *     available is false when the local API cannot be reached (caller
	 *     should fall back to the local history). matches is aligned with
	 *     items: undefined for items without a matchable fingerprint (and
	 *     webpages), null for checked items with no match, otherwise
	 *     {key, title, doi, collections, tags, sessionID?, savedAt?} where
	 *     sessionID refers to the connector save session that created the
	 *     item, when it is still known and recent enough to be alive.
	 */
	this.checkInLibrary = async function(items) {
		let history = loadHistory();
		let matches = [];
		for (let item of items || []) {
			let fp = fingerprint(item);
			if (!fp) {
				matches.push(undefined);
				continue;
			}
			let found = null;
			try {
				let query = encodeURIComponent(String(item.title || '').slice(0, 100));
				let apiItems = await apiGet(`/items?q=${query}&limit=50&format=json`);
				let apiItem = matchApiItem(fp, apiItems);
				if (apiItem) {
					let data = apiItem.data || apiItem;
					found = {
						key: apiItem.key,
						title: data.title || fp.titleText,
						doi: normalizeDOI(data.DOI) || fp.doi,
						collections: data.collections || [],
						tags: (data.tags || []).map(t => ({ tag: t.tag, type: t.type }))
					};
					// Cross-reference the local history for a still-live save
					// session that could be used to update this item
					let h = history.find(h => (fp.doi && h.doi == fp.doi)
						|| (fp.title && h.title == fp.title));
					if (h && h.sessionID && Date.now() - h.t < SESSION_TTL_MS) {
						found.sessionID = h.sessionID;
						found.savedAt = h.t;
					}
				}
			}
			catch (e) {
				Zotero.debug(`DuplicateChecker: local API unavailable: ${e.message || e}`);
				return { available: false, matches: [] };
			}
			matches.push(found);
		}
		return { available: true, matches };
	};

	/**
	 * Record items as saved so future saves can be checked against them,
	 * remembering the session that saved them (usable for ~10 minutes to
	 * update the item through the client).
	 * @param {String} sessionID
	 * @param {Object[]} items - items that were just saved
	 */
	this.remember = function(sessionID, items) {
		let history = loadHistory();
		for (let item of items || []) {
			let fp = fingerprint(item);
			if (!fp) continue;
			let existing = history.find(h => (fp.doi && h.doi == fp.doi)
				|| (fp.title && h.title == fp.title));
			if (existing) {
				// Refresh so the latest live session is remembered for updates
				existing.t = Date.now();
				existing.sessionID = sessionID;
				continue;
			}
			history.push({ doi: fp.doi, title: fp.title, titleText: fp.titleText, t: Date.now(), sessionID });
		}
		while (history.length > MAX_HISTORY_SIZE) history.shift();
		return Promise.resolve(saveHistory(history));
	};

	// Pure helpers exposed for tests
	this._internals = {
		normalizeDOI,
		normalizeTitle,
		fingerprint,
		findMatches
	};
};
