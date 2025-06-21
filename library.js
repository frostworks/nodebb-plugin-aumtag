'use strict';

const topics = require.main.require('./src/topics');
const plugin = {};

/**
 * Parses hashtags from a given string of content.
 * Returns an array of unique hashtag strings without the '#'.
 * @param {string} content - The post content to parse.
 * @returns {string[]} - An array of unique hashtags (e.g., ['nodebb', 'javascript']).
 */
const parseHashtags = (content) => {
	if (!content) {
		return [];
	}
	// This regex finds hashtags, handles various characters, and avoids hashtags in links.
	const rawTags = content.match(/(?<!\S)#[a-zA-Z0-9\-_]+/g) || [];
	// Return unique tags, cleaned of the '#' prefix.
	return [...new Set(rawTags.map(tag => tag.substring(1)))];
};

/**
 * Atomically updates the hashtag counts for a given topic.
 * @param {number} tid - The topic ID.
 * @param {string[]} tagsToIncrement - An array of tags whose counts should be increased.
 * @param {string[]} tagsToDecrement - An array of tags whose counts should be decreased.
 */
const updateTopicHashtagCounts = async (tid, tagsToIncrement = [], tagsToDecrement = []) => {
	if (!tid || (tagsToIncrement.length === 0 && tagsToDecrement.length === 0)) {
		return;
	}

	try {
		// Fetch the current counts object from the topic data.
		const currentCountsJSON = await topics.getTopicField(tid, 'hashtagCounts');
		const counts = currentCountsJSON ? JSON.parse(currentCountsJSON) : {};

		// Increment counts for new/added tags
		for (const tag of tagsToIncrement) {
			counts[tag] = (counts[tag] || 0) + 1;
		}

		// Decrement counts for removed/deleted tags
		for (const tag of tagsToDecrement) {
			counts[tag] = (counts[tag] || 1) - 1;
			// Clean up tags with zero or negative counts
			if (counts[tag] <= 0) {
				delete counts[tag];
			}
		}

		// Save the updated counts object back to the topic data.
		// Stringify the object for storage in the Redis hash.
		await topics.setTopicField(tid, 'hashtagCounts', JSON.stringify(counts));

	} catch (err) {
		console.error(`[plugin/topic-hashtag-counts] Failed to update counts for TID ${tid}`, err);
	}
};


/**
 * Hook handler for when a post is created or edited.
 * @param {object} data - The hook data object.
 * @param {object} data.post - The post object being saved.
 * @param {object} [data.originalPostData] - The original post data before the edit (if applicable).
 */
plugin.handlePostSave = async (data) => {
	const { post, originalPostData } = data;
	const { tid, content } = post;
    const isNew = !originalPostData;

	console.log(post, originalPostData, tid, content, isNew);

	if (!tid) return;

	if (isNew) {
		// This is a brand new post.
		const tags = parseHashtags(content);
		await updateTopicHashtagCounts(tid, tags, []);
	} else {
		// This is an existing post being edited.
		const oldTags = parseHashtags(originalPostData.content);
		const newTags = parseHashtags(content);

		const tagsToIncrement = newTags.filter(tag => !oldTags.includes(tag));
		const tagsToDecrement = oldTags.filter(tag => !newTags.includes(tag));

		await updateTopicHashtagCounts(tid, tagsToIncrement, tagsToDecrement);
	}
};

/**
 * Hook handler for when a post is deleted.
 * @param {object} data - The hook data object.
 * @param {object} data.post - The post object that was deleted.
 */
plugin.handlePostDelete = async (data) => {
	const { post } = data;
	const { tid, content } = post;

	if (!tid) return;

	const tags = parseHashtags(content);
	// On delete, we decrement the counts for the tags in the post.
	await updateTopicHashtagCounts(tid, [], tags);
};

/**
 * Hook handler for when a post is restored from a deleted state.
 * @param {object} data - The hook data object.
 * @param {object} data.post - The post object that was restored.
 */
plugin.handlePostRestore = async (data) => {
	const { post } = data;
	const { tid, content } = post;

	if (!tid) return;

	const tags = parseHashtags(content);
	// On restore, we increment the counts back.
	await updateTopicHashtagCounts(tid, tags, []);
};

module.exports = plugin;