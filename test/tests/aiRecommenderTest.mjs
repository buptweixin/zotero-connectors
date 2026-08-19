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

import { background, stubConnectorCallMethod } from '../support/utils.mjs';

describe("AIRecommender", function() {
	describe('#parseJSONResponse()', function() {
		it('parses plain JSON', async function() {
			let parsed = await background(() => Zotero.AIRecommender._internals.parseJSONResponse(
				'{"collectionId": "C1", "tags": ["a"]}'
			));
			if (parsed.collectionId != 'C1' || parsed.tags[0] != 'a') {
				throw new Error(`Unexpected parse result: ${JSON.stringify(parsed)}`);
			}
		});

		it('parses JSON in markdown fences', async function() {
			let parsed = await background(() => Zotero.AIRecommender._internals.parseJSONResponse(
				'```json\n{"collectionId": null, "tags": []}\n```'
			));
			if (parsed.collectionId !== null || parsed.tags.length != 0) {
				throw new Error(`Unexpected parse result: ${JSON.stringify(parsed)}`);
			}
		});

		it('extracts JSON embedded in surrounding text', async function() {
			let parsed = await background(() => Zotero.AIRecommender._internals.parseJSONResponse(
				'Here is my suggestion: {"collectionId": "C2", "tags": ["b"]} hope it helps!'
			));
			if (parsed.collectionId != 'C2' || parsed.tags[0] != 'b') {
				throw new Error(`Unexpected parse result: ${JSON.stringify(parsed)}`);
			}
		});

		it('returns null for garbage', async function() {
			let parsed = await background(() => Zotero.AIRecommender._internals.parseJSONResponse(
				'Sorry, I cannot answer that.'
			));
			if (parsed !== null) {
				throw new Error(`Expected null, got: ${JSON.stringify(parsed)}`);
			}
		});
	});

	describe('#validateSuggestion()', function() {
		const TARGETS = [
			{ id: 'L1', name: 'My Library', level: 0 },
			{ id: 'C1', name: 'Machine Learning', level: 1 },
			{ id: 'C2', name: 'Databases', level: 1 }
		];

		it('keeps a collection id that exists in targets', async function() {
			let suggestion = await background((targets, parsed) => {
				return Zotero.AIRecommender._internals.validateSuggestion(parsed, targets, { maxTags: 5 });
			}, TARGETS, { collectionId: 'C1', tags: [] });
			if (!suggestion.collection || suggestion.collection.id != 'C1'
					|| suggestion.collection.name != 'Machine Learning') {
				throw new Error(`Unexpected suggestion: ${JSON.stringify(suggestion)}`);
			}
		});

		it('drops a collection id invented by the model', async function() {
			let suggestion = await background((targets, parsed) => {
				return Zotero.AIRecommender._internals.validateSuggestion(parsed, targets, { maxTags: 5 });
			}, TARGETS, { collectionId: 'C999', newCollectionName: 'Fake', tags: [] });
			if (suggestion.collection) {
				throw new Error(`Collection should have been dropped: ${JSON.stringify(suggestion)}`);
			}
			// The new-collection suggestion survives, since no existing collection matched
			if (suggestion.newCollectionName != 'Fake') {
				throw new Error(`Unexpected suggestion: ${JSON.stringify(suggestion)}`);
			}
		});

		it('drops newCollectionName when an existing collection matched', async function() {
			let suggestion = await background((targets, parsed) => {
				return Zotero.AIRecommender._internals.validateSuggestion(parsed, targets, { maxTags: 5 });
			}, TARGETS, { collectionId: 'C1', newCollectionName: 'Other', tags: [] });
			if (!suggestion.collection || suggestion.newCollectionName !== null) {
				throw new Error(`Unexpected suggestion: ${JSON.stringify(suggestion)}`);
			}
		});

		it('dedupes, sanitizes and caps tags', async function() {
			let suggestion = await background((targets, parsed) => {
				return Zotero.AIRecommender._internals.validateSuggestion(parsed, targets, { maxTags: 3 });
			}, TARGETS, {
				tags: ['LLM', 'llm', '  RAG  ', 42, null, 'x'.repeat(100), 'a', 'b', 'c', 'd']
			});
			let tags = suggestion.tags;
			if (tags.length != 3) {
				throw new Error(`Expected 3 tags, got ${tags.length}: ${JSON.stringify(tags)}`);
			}
			if (tags[0] != '#LLM' || tags[1] != '#RAG') {
				throw new Error(`Unexpected tags: ${JSON.stringify(tags)}`);
			}
			if (tags.some(t => typeof t != 'string' || t.length > 64)) {
				throw new Error(`Unexpected tags: ${JSON.stringify(tags)}`);
			}
		});

		it('reuses existing library tags verbatim and prefixes new tags with #', async function() {
			let suggestion = await background((targets, parsed, existingEntries) => {
				let existingTags = Zotero.AIRecommender._internals.buildExistingTagsMap(existingEntries);
				return Zotero.AIRecommender._internals.validateSuggestion(parsed, targets, { maxTags: 5 }, existingTags);
			}, TARGETS, {
				tags: ['llm', 'LLM', 'machine Learning', 'rl', 'transformers']
			}, [
				{ tag: 'LLM' },
				{ tag: 'Machine Learning' },
				{ tag: '#RL' }
			]);
			let tags = suggestion.tags;
			// 'LLM'/'llm' collapse onto the library spelling, 'rl' reuses the
			// existing '#RL' across the '#' boundary, 'transformers' is new
			if (JSON.stringify(tags) != JSON.stringify(['LLM', 'Machine Learning', '#RL', '#transformers'])) {
				throw new Error(`Unexpected tags: ${JSON.stringify(tags)}`);
			}
		});

		it('buildExistingTagsMap keys ignore case and a leading #', async function() {
			let map = await background((libraryTags) => {
				return Array.from(Zotero.AIRecommender._internals.buildExistingTagsMap(libraryTags));
			}, [{ tag: 'LLM' }, { tag: '  Reinforcement Learning ' }, 'weird', { tag: '#RL' }, { tag: '' }]);
			let keys = map.map(([k]) => k);
			if (map.length != 4
					|| !keys.includes('llm') || !keys.includes('reinforcement learning')
					|| !keys.includes('rl') || !keys.includes('weird')) {
				throw new Error(`Unexpected map: ${JSON.stringify(map)}`);
			}
			if (!map.some(([k, v]) => k == 'rl' && v == '#RL')) {
				throw new Error(`'#RL' should map back to its exact spelling: ${JSON.stringify(map)}`);
			}
		});

		it('handles null input', async function() {
			let suggestion = await background((targets) => {
				return Zotero.AIRecommender._internals.validateSuggestion(null, targets, { maxTags: 5 });
			}, TARGETS);
			if (suggestion.collection || suggestion.tags.length || suggestion.newCollectionName) {
				throw new Error(`Expected empty suggestion: ${JSON.stringify(suggestion)}`);
			}
		});
	});

	describe('#selectCollectionCandidates()', function() {
		it('reconstructs full paths from levels', async function() {
			let targets = [
				{ id: 'L1', name: 'My Library', level: 0 },
				{ id: 'C1', name: 'ML', level: 1 },
				{ id: 'C2', name: 'LLM', level: 2 },
				{ id: 'L2', name: 'Group', level: 0 },
				{ id: 'C3', name: 'Papers', level: 1 }
			];
			let candidates = await background((targets) => {
				return Zotero.AIRecommender._internals.selectCollectionCandidates(targets);
			}, targets);
			let expected = [
				['L1', 'My Library'],
				['C1', 'My Library / ML'],
				['C2', 'My Library / ML / LLM'],
				['L2', 'Group'],
				['C3', 'Group / Papers']
			];
			for (let i = 0; i < expected.length; i++) {
				if (candidates[i].id != expected[i][0] || candidates[i].path != expected[i][1]) {
					throw new Error(`Row ${i}: expected ${expected[i]}, got ${JSON.stringify(candidates[i])}`);
				}
			}
		});
	});

	describe('#selectTagCandidates()', function() {
		it('only keeps tags relevant to the item text', async function() {
			let clientData = {
				libraryID: 1,
				tags: { 1: [{ tag: 'transformer' }, { tag: 'quantum computing' }, { tag: 'NLP' }] }
			};
			let item = { title: 'Attention Is All You Need', abstractNote: 'We propose the Transformer architecture for NLP.' };
			let tags = await background((clientData, item) => {
				return Zotero.AIRecommender._internals.selectTagCandidates(clientData, item);
			}, clientData, item);
			if (tags.includes('transformer') && tags.includes('NLP')) {
				if (tags.includes('quantum computing')) {
					throw new Error(`Irrelevant tag kept: ${JSON.stringify(tags)}`);
				}
			}
			else {
				throw new Error(`Relevant tags missing: ${JSON.stringify(tags)}`);
			}
		});
	});

	describe('#buildPrompt()', function() {
		it('includes metadata, candidates and the output schema', async function() {
			let item = {
				title: 'A Paper Title',
				abstractNote: 'An abstract',
				creators: 'Doe, Jane',
				publicationTitle: 'Nature',
				itemType: 'journalArticle',
				url: 'https://example.com'
			};
			let prompt = await background((item) => {
				let { system, user } = Zotero.AIRecommender._internals.buildPrompt(
					item,
					[{ id: 'C1', path: 'My Library / ML' }],
					['llm', 'rag'],
					4
				);
				return { system, user };
			}, item);
			for (let expected of ['A Paper Title', 'An abstract', 'C1', 'My Library / ML', 'llm', 'rag']) {
				if (!prompt.user.includes(expected)) {
					throw new Error(`User prompt missing "${expected}":\n${prompt.user}`);
				}
			}
			for (let expected of ['collectionId', 'newCollectionName', 'tags', 'reason']) {
				if (!prompt.system.includes(expected)) {
					throw new Error(`System prompt missing "${expected}"`);
				}
			}
			if (!prompt.system.includes('2 and 4')) {
				throw new Error('System prompt should cap tags at maxTags');
			}
			if (!prompt.system.includes('"#"') || !prompt.system.includes('#RL')) {
				throw new Error('System prompt should require new tags to start with "#"');
			}
		});
	});

	describe('#getConfig()', function() {
		const TEST_PREFS = {
			'ai.enabled': true,
			'ai.provider': 'openai',
			'ai.baseUrl': 'https://api.example.com/v1',
			'ai.apiKey': 'test-key',
			'ai.model': 'test-model',
			'ai.maxTags': 99
		};

		afterEach(async function() {
			await background(async () => {
				await Zotero.Prefs.set('ai.enabled', false);
				await Zotero.Prefs.set('ai.provider', 'openai');
				await Zotero.Prefs.set('ai.baseUrl', '');
				await Zotero.Prefs.set('ai.apiKey', '');
				await Zotero.Prefs.set('ai.model', '');
				await Zotero.Prefs.set('ai.maxTags', 5);
			});
		});

		it('returns null when disabled', async function() {
			let config = await background(async () => {
				await Zotero.Prefs.set('ai.enabled', false);
				await Zotero.Prefs.set('ai.baseUrl', 'https://api.example.com/v1');
				await Zotero.Prefs.set('ai.model', 'test-model');
				return Zotero.AIRecommender.getConfig();
			});
			if (config !== null) {
				throw new Error(`Expected null config when disabled: ${JSON.stringify(config)}`);
			}
		});

		it('returns null when endpoint not fully configured', async function() {
			let config = await background(async () => {
				await Zotero.Prefs.set('ai.enabled', true);
				await Zotero.Prefs.set('ai.baseUrl', '');
				await Zotero.Prefs.set('ai.model', 'test-model');
				return Zotero.AIRecommender.getConfig();
			});
			if (config !== null) {
				throw new Error(`Expected null config without baseUrl: ${JSON.stringify(config)}`);
			}
		});

		it('requires an API key for anthropic but not for openai-compatible endpoints', async function() {
			let configs = await background(async () => {
				await Zotero.Prefs.set('ai.enabled', true);
				await Zotero.Prefs.set('ai.baseUrl', 'https://api.example.com');
				await Zotero.Prefs.set('ai.apiKey', '');
				await Zotero.Prefs.set('ai.model', 'test-model');
				await Zotero.Prefs.set('ai.provider', 'anthropic');
				let anthropic = Zotero.AIRecommender.getConfig();
				await Zotero.Prefs.set('ai.provider', 'openai');
				let openai = Zotero.AIRecommender.getConfig();
				return { anthropic: anthropic && 'config', openai: openai && 'config' };
			});
			if (configs.anthropic) {
				throw new Error('Anthropic config should require an API key');
			}
			if (!configs.openai) {
				throw new Error('OpenAI-compatible config should work without an API key (e.g. local endpoints)');
			}
		});

		it('clamps maxTags', async function() {
			let config = await background(async (prefs) => {
				for (let key of Object.keys(prefs)) {
					await Zotero.Prefs.set(key, prefs[key]);
				}
				return Zotero.AIRecommender.getConfig();
			}, TEST_PREFS);
			if (!config || config.maxTags != 10) {
				throw new Error(`Expected maxTags clamped to 10: ${JSON.stringify(config)}`);
			}
		});
	});

	describe('#recommend()', function() {
		it('reports not-configured without any network access', async function() {
			let result = await background(async () => {
				await Zotero.Prefs.set('ai.enabled', true);
				await Zotero.Prefs.set('ai.baseUrl', '');
				await Zotero.Prefs.set('ai.model', '');
				return Zotero.AIRecommender.recommend({
					sessionID: 'test-session',
					item: { title: 'A Paper' }
				});
			});
			if (result.error != 'not-configured') {
				throw new Error(`Expected not-configured: ${JSON.stringify(result)}`);
			}
		});

		it('shares one in-flight request between concurrent calls for the same session', async function() {
			let restoreCallMethod = await stubConnectorCallMethod({
				getSelectedCollection: {
					response: {
						libraryID: 1,
						targets: [
							{ id: 'L1', name: 'My Library', level: 0 },
							{ id: 'C1', name: 'ML', level: 1 }
						],
						tags: {}
					}
				}
			});
			try {
				let result = await background(async () => {
					await Zotero.Prefs.set('ai.enabled', true);
					await Zotero.Prefs.set('ai.provider', 'openai');
					await Zotero.Prefs.set('ai.baseUrl', 'https://api.example.com/v1');
					await Zotero.Prefs.set('ai.model', 'test-model');
					let origCallLLM = Zotero.AIRecommender._callLLM;
					let llmCalls = 0;
					Zotero.AIRecommender._callLLM = async function() {
						llmCalls++;
						await new Promise(resolve => setTimeout(resolve, 100));
						return '{"collectionId": "C1", "tags": ["llm"], "reason": "matched collection"}';
					};
					try {
						let [first, second] = await Promise.all([
							Zotero.AIRecommender.recommend({
								sessionID: 'test-concurrent', item: { title: 'A Paper' }
							}),
							Zotero.AIRecommender.recommend({
								sessionID: 'test-concurrent', item: { title: 'A Paper' }
							})
						]);
						return { llmCalls, identical: first === second, first };
					}
					finally {
						Zotero.AIRecommender._callLLM = origCallLLM;
						await Zotero.Prefs.set('ai.enabled', false);
						await Zotero.Prefs.set('ai.baseUrl', '');
						await Zotero.Prefs.set('ai.model', '');
					}
				});
				if (result.llmCalls != 1) {
					throw new Error(`Expected a single LLM call, got ${result.llmCalls}`);
				}
				if (!result.identical) {
					throw new Error('Concurrent callers should receive the same suggestion object');
				}
				if (result.first.error || !result.first.collection || result.first.collection.id != 'C1') {
					throw new Error(`Unexpected suggestion: ${JSON.stringify(result.first)}`);
				}
			}
			finally {
				await restoreCallMethod();
			}
		});
	});
});
