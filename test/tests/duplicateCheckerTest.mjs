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

import { background } from '../support/utils.mjs';

describe("DuplicateChecker", function() {
	afterEach(async function() {
		await background(async () => {
			await Zotero.Prefs.set('duplicateChecker.history', []);
		});
	});

	describe('#normalizeDOI()', function() {
		it('strips URL prefixes and normalizes case', async function() {
			let results = await background(() => {
				let { normalizeDOI } = Zotero.DuplicateChecker._internals;
				return [
					normalizeDOI('https://doi.org/10.1000/ABC.123'),
					normalizeDOI('http://dx.doi.org/10.1000/abc.123'),
					normalizeDOI('doi:10.1000/ABC.123'),
					normalizeDOI(' 10.1000/abc.123 '),
					normalizeDOI('')
				];
			});
			for (let i = 0; i < 4; i++) {
				if (results[i] != '10.1000/abc.123') {
					throw new Error(`Variant ${i} normalized to ${results[i]}`);
				}
			}
			if (results[4] !== null) {
				throw new Error(`Empty DOI should be null, got ${results[4]}`);
			}
		});
	});

	describe('#normalizeTitle()', function() {
		it('folds case, punctuation and CJK text', async function() {
			let results = await background(() => {
				let { normalizeTitle } = Zotero.DuplicateChecker._internals;
				return [
					normalizeTitle('Attention Is All You Need!'),
					normalizeTitle('attention is all you need'),
					normalizeTitle('  Attention:   is—all you need  '),
					normalizeTitle('强化学习综述：方法与应用')
				];
			});
			if (results[0] != results[1] || results[0] != results[2]) {
				throw new Error(`Variants should fold identically: ${JSON.stringify(results)}`);
			}
			if (results[3].length < 5) {
				throw new Error(`CJK title collapsed unexpectedly: ${results[3]}`);
			}
		});
	});

	describe('#fingerprint()', function() {
		it('excludes webpages and too-short titles', async function() {
			let results = await background(() => {
				let { fingerprint } = Zotero.DuplicateChecker._internals;
				return [
					!!fingerprint({ itemType: 'webpage', title: 'A Long Enough Title Here', DOI: '10.1/x' }),
					!!fingerprint({ itemType: 'journalArticle', title: 'Short' }),
					!!fingerprint({ itemType: 'journalArticle', title: 'Short', DOI: '10.1/x' }),
					fingerprint({ itemType: 'journalArticle', title: 'A Long Enough Title Here' }).title
				];
			});
			if (results[0]) throw new Error('webpage should be excluded');
			if (results[1]) throw new Error('short title without DOI should be excluded');
			if (!results[2]) throw new Error('DOI alone should be enough');
			if (results[3] !== 'a long enough title here') {
				throw new Error(`Unexpected normalized title: ${results[3]}`);
			}
		});
	});

	describe('#check() / #remember()', function() {
		it('detects re-saves by DOI and by title, ignores webpages and new items', async function() {
			let result = await background(async () => {
				await Zotero.DuplicateChecker.remember('s1', [
					{ itemType: 'journalArticle', title: 'Attention Is All You Need',
						DOI: '10.5555/3295222.3295349' },
					{ itemType: 'journalArticle', title: 'Deep Residual Learning for Image Recognition' },
					{ itemType: 'webpage', title: 'Some Page We Snapshot Often' }
				]);

				let byDOI = await Zotero.DuplicateChecker.check([
					{ itemType: 'journalArticle', title: 'Attention Is Certainly All You Need',
						DOI: 'https://doi.org/10.5555/3295222.3295349' }
				]);
				let byTitle = await Zotero.DuplicateChecker.check([
					{ itemType: 'journalArticle', title: 'deep residual learning: for image recognition!' }
				]);
				let webpage = await Zotero.DuplicateChecker.check([
					{ itemType: 'webpage', title: 'Some Page We Snapshot Often' }
				]);
				let fresh = await Zotero.DuplicateChecker.check([
					{ itemType: 'journalArticle', title: 'A Brand New Paper Nobody Saved Before' }
				]);
				return { byDOI, byTitle, webpage, fresh };
			});

			if (result.byDOI.duplicates.length != 1
					|| result.byDOI.duplicates[0].doi != '10.5555/3295222.3295349') {
				throw new Error(`DOI match failed: ${JSON.stringify(result.byDOI)}`);
			}
			if (result.byTitle.duplicates.length != 1) {
				throw new Error(`Title match failed: ${JSON.stringify(result.byTitle)}`);
			}
			if (result.webpage.duplicates.length) {
				throw new Error(`Webpage should not be flagged: ${JSON.stringify(result.webpage)}`);
			}
			if (result.fresh.duplicates.length) {
				throw new Error(`Fresh item should not be flagged: ${JSON.stringify(result.fresh)}`);
			}
		});

		it('records each item only once', async function() {
			let count = await background(async () => {
				let item = { itemType: 'journalArticle', title: 'Only Recorded Once Paper', DOI: '10.9/once' };
				await Zotero.DuplicateChecker.remember('s1', [item]);
				await Zotero.DuplicateChecker.remember('s2', [item]);
				return (await Zotero.Prefs.getAsync('duplicateChecker.history')).length;
			});
			if (count != 1) {
				throw new Error(`Expected 1 history entry, got ${count}`);
			}
		});
	});
});
