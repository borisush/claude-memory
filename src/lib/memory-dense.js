/**
 * Dense Embedding Library — Pure JS, No Dependencies
 *
 * Hashed character n-gram + word unigram embeddings for memory entries.
 * Deterministic, fast, ~256-dimensional, L2-normalized.
 *
 * Why this approach:
 *   The paper's set-union hybrid search wants a signal that catches what BM25
 *   MISSES — substring matches, typos, morphological variants — not better
 *   semantic matches. Hashed n-grams provide exactly that, with zero deps.
 *
 *   For true semantic embeddings, swap embedText() for a sentence-transformers
 *   call (Python subprocess) or transformers.js — the rest of the pipeline is
 *   unchanged because everything else operates on Float32Arrays.
 */

'use strict';

const DIM = 256;
const NGRAM = 3;

/**
 * FNV-1a hash → 32-bit unsigned integer.
 * Fast, well-distributed, deterministic across runs.
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Compute a hashed feature embedding for text.
 * - Word unigrams (heavier weight, captures keyword semantics)
 * - Character trigrams (catches substrings, prefixes, typos)
 * Projected to DIM via feature hashing with sign trick (Weinberger 2009),
 * then L2-normalized so cosine similarity == dot product.
 *
 * @param {string} text
 * @returns {Float32Array} length DIM
 */
function embedText(text) {
  const v = new Float32Array(DIM);
  if (!text || typeof text !== 'string') return v;
  const lower = text.toLowerCase();

  // Word unigrams
  const words = lower.split(/[^a-z0-9]+/).filter(w => w.length >= 2);
  for (const w of words) {
    const h = fnv1a(w);
    const idx = h % DIM;
    const sign = (h & 0x100) ? -1 : 1;
    v[idx] += sign * 1.5;
  }

  // Character trigrams (with space padding so word boundaries are features)
  const padded = ` ${lower} `;
  for (let i = 0; i <= padded.length - NGRAM; i++) {
    const tri = padded.slice(i, i + NGRAM);
    if (!/[a-z0-9]/.test(tri)) continue;
    const h = fnv1a(tri);
    const idx = h % DIM;
    const sign = (h & 0x100) ? -1 : 1;
    v[idx] += sign * 1.0;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) v[i] /= norm;
  }
  return v;
}

/**
 * Cosine similarity between two L2-normalized vectors.
 * Both vectors must already be normalized — this is just the dot product.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} similarity in [-1, 1]
 */
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Encode a Float32Array as base64 for compact JSON storage.
 * 256 floats × 4 bytes = 1024 bytes raw → ~1366 chars base64.
 */
function encodeEmbedding(vec) {
  const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  return buf.toString('base64');
}

/**
 * Decode a base64 string back into a Float32Array.
 * Returns null if input is invalid.
 */
function decodeEmbedding(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    // Copy to a clean ArrayBuffer to ensure 4-byte alignment
    const aligned = new ArrayBuffer(buf.length);
    new Uint8Array(aligned).set(buf);
    return new Float32Array(aligned);
  } catch {
    return null;
  }
}

module.exports = {
  DIM,
  embedText,
  cosineSim,
  encodeEmbedding,
  decodeEmbedding,
};
