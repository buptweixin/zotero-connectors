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
 * Duplicate detection for saved items, based on a local history of items
 * previously saved through this connector.
 *
 * The Zotero client's connector API has no way to search an existing library,
 * so detection is limited to items that were saved via the connector itself
 * (which covers the common case of re-saving the same paper). Runs in the
 * background only; the inject side calls check()/remember() via messaging.
 */
Zotero.DuplicateChecker = new function() {
	const HISTORY_PREF = 'duplicateChecker.history';
	const MAX_HISTORY_SIZE = 5000;
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

	/**
	 * Record items as saved so future saves can be checked against them
	 * @param {String} sessionID
	 * @param {Object[]} items - items that were just saved
	 */
	this.remember = function(sessionID, items) {
		let history = loadHistory();
		let knownDOIs = new Set(history.map(h => h.doi).filter(Boolean));
		let knownTitles = new Set(history.map(h => h.title).filter(Boolean));
		for (let item of items || []) {
			let fp = fingerprint(item);
			if (!fp) continue;
			if ((fp.doi && knownDOIs.has(fp.doi)) || (fp.title && knownTitles.has(fp.title))) continue;
			history.push({ doi: fp.doi, title: fp.title, titleText: fp.titleText, t: Date.now() });
			if (fp.doi) knownDOIs.add(fp.doi);
			if (fp.title) knownTitles.add(fp.title);
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
