// The tool surface the model is given, plus the tour contract it must satisfy.
//
// Design note: this is a *reading* toolset, not a lookup table. search_corpus
// finds candidate moments, transcript_window makes the model actually read the
// tape before it commits a clip, and submit_tour is the only way out. Nothing
// hands back a whole episode, so a model cannot substitute bulk for judgement.

import {
  searchCorpus,
  momentsForPassage,
  transcriptWindow,
  episodeInfo,
  listSources,
  episodeMeta,
  sourceDrifts,
  sourceName,
  MAX_WINDOW_SECONDS,
} from './corpus.mjs';

export const MIN_CLIP_SECONDS = 20;
export const MAX_CLIP_SECONDS = 900; // 15 minutes
export const MIN_STEPS = 3;
export const MAX_STEPS = 8;

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'list_sources',
      description:
        'List the podcast shows in the corpus with episode counts and hours. Call this first if you are unsure which show is likely to treat a topic well.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_corpus',
      description:
        'Keyword search across all 3,521 episode transcripts. Returns ranked hits with recordId, the timestamp of the best-matching passage, and the surrounding transcript text. Use several differently-worded searches rather than one; the index is keyword-based, so search for the words a speaker would actually say.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words a speaker would actually use out loud.' },
          sourceId: {
            type: 'string',
            description: 'Optional: restrict to one show, e.g. "naked-bible". Get ids from list_sources.',
          },
          limit: { type: 'integer', description: 'Max hits, 1-15. Default 8.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moments_for_passage',
      description:
        'Every timestamped moment in the corpus where a given scripture chapter (optionally a verse) is treated, with the relation kind (subject / crossref / allusion / quotation) and how long the treatment runs. Use this whenever the user names a text.',
      parameters: {
        type: 'object',
        properties: {
          book: { type: 'string', description: 'Book name or code, e.g. "Genesis" or "GEN".' },
          chapter: { type: 'integer' },
          verse: { type: 'integer', description: 'Optional single verse to filter to.' },
          limit: { type: 'integer', description: 'Max moments, 1-40. Default 25.' },
        },
        required: ['book', 'chapter'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transcript_window',
      description: `Read the transcript between two timestamps of one episode. Capped at ${MAX_WINDOW_SECONDS}s of tape per call. Read before you commit a clip: the search snippet is not enough to know where a thought starts and ends.`,
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          fromSec: { type: 'integer' },
          toSec: { type: 'integer' },
        },
        required: ['recordId', 'fromSec', 'toSec'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'episode_info',
      description:
        'Title, show, duration, a coarse outline, and every scripture moment detected in one episode. Useful for placing a clip in its context before you write the "why".',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_tour',
      description:
        'Submit the finished listening tour. This is the only way to finish. The server validates it strictly and will hand back errors for you to fix rather than repairing it for you.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Name of the tour, under 120 characters.' },
          intro: {
            type: 'string',
            description: 'A short paragraph telling the listener what this tour will do for their question.',
          },
          steps: {
            type: 'array',
            description: `${MIN_STEPS} to ${MAX_STEPS} clips, ordered so they build.`,
            items: {
              type: 'object',
              properties: {
                recordId: { type: 'string' },
                startSec: { type: 'integer' },
                endSec: { type: 'integer' },
                why: {
                  type: 'string',
                  description:
                    'Why this clip, here, in this order — grounded in what the transcript actually says. Quote a phrase from the tape.',
                },
              },
              required: ['recordId', 'startSec', 'endSec', 'why'],
            },
          },
          closing: { type: 'string', description: 'A short paragraph landing the tour.' },
        },
        required: ['title', 'intro', 'steps', 'closing'],
      },
    },
  },
];

const clampInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/** Strict validation. Returns { ok, errors[], tour } — never repairs quietly. */
export function validateTour(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['tour must be a JSON object'] };

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) errors.push('title: required non-empty string');
  else if (title.length > 120) errors.push(`title: ${title.length} chars, must be <= 120`);

  const intro = typeof input.intro === 'string' ? input.intro.trim() : '';
  if (intro.length < 40) errors.push('intro: required, at least 40 characters');

  const closing = typeof input.closing === 'string' ? input.closing.trim() : '';
  if (closing.length < 30) errors.push('closing: required, at least 30 characters');

  const rawSteps = Array.isArray(input.steps) ? input.steps : null;
  if (!rawSteps) errors.push('steps: required array');
  else if (rawSteps.length < MIN_STEPS || rawSteps.length > MAX_STEPS) {
    errors.push(`steps: ${rawSteps.length} given, must be between ${MIN_STEPS} and ${MAX_STEPS}`);
  }

  const steps = [];
  if (rawSteps) {
    rawSteps.forEach((s, i) => {
      const at = `steps[${i}]`;
      if (!s || typeof s !== 'object') {
        errors.push(`${at}: must be an object`);
        return;
      }
      const recordId = typeof s.recordId === 'string' ? s.recordId.trim() : '';
      const meta = recordId ? episodeMeta(recordId) : null;
      if (!recordId) errors.push(`${at}.recordId: required`);
      else if (!meta) errors.push(`${at}.recordId: "${recordId}" is not an episode in this corpus`);

      const startSec = clampInt(s.startSec);
      const endSec = clampInt(s.endSec);
      if (!Number.isFinite(startSec) || startSec < 0) errors.push(`${at}.startSec: required integer >= 0`);
      if (!Number.isFinite(endSec)) errors.push(`${at}.endSec: required integer`);

      if (Number.isFinite(startSec) && Number.isFinite(endSec)) {
        const len = endSec - startSec;
        if (len < MIN_CLIP_SECONDS) errors.push(`${at}: clip is ${len}s, minimum is ${MIN_CLIP_SECONDS}s`);
        else if (len > MAX_CLIP_SECONDS) errors.push(`${at}: clip is ${len}s, maximum is ${MAX_CLIP_SECONDS}s (15 min)`);
        if (meta && meta.audioSeconds && endSec > meta.audioSeconds) {
          errors.push(`${at}.endSec ${endSec} runs past the end of "${meta.title}" (${meta.audioSeconds}s)`);
        }
      }

      const why = typeof s.why === 'string' ? s.why.trim() : '';
      if (why.length < 40) errors.push(`${at}.why: required, at least 40 characters explaining the pick`);

      steps.push({ recordId, startSec, endSec, why });
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], tour: { title, intro, steps, closing } };
}

/** Attach the playback + provenance facts the page needs. Never invented. */
export function decorateTour(tour) {
  return {
    ...tour,
    totalSeconds: tour.steps.reduce((a, s) => a + (s.endSec - s.startSec), 0),
    steps: tour.steps.map((s) => {
      const meta = episodeMeta(s.recordId);
      const sourceId = meta ? meta.sourceId : String(s.recordId).split(':')[0];
      return {
        ...s,
        episodeTitle: meta ? meta.title : s.recordId,
        sourceId,
        source: sourceName(sourceId),
        audioUrl: meta ? meta.audioUrl : null,
        durationSec: meta ? meta.audioSeconds : null,
        adInsertionDrift: sourceDrifts(sourceId),
      };
    }),
  };
}

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}… [truncated]` : s);

/** Run one tool call. Returns { name, args, ms, result, summary }. */
export function runTool(name, args) {
  const started = Date.now();
  let result;
  switch (name) {
    case 'list_sources':
      result = listSources();
      break;
    case 'search_corpus':
      result = searchCorpus({
        query: String(args.query ?? ''),
        sourceId: args.sourceId ? String(args.sourceId) : null,
        limit: Math.min(15, Math.max(1, Number(args.limit) || 8)),
      });
      break;
    case 'moments_for_passage':
      result = momentsForPassage({
        book: String(args.book ?? ''),
        chapter: Number(args.chapter),
        verse: args.verse == null ? null : Number(args.verse),
        limit: Math.min(40, Math.max(1, Number(args.limit) || 25)),
      });
      break;
    case 'transcript_window':
      result = transcriptWindow({
        recordId: String(args.recordId ?? ''),
        fromSec: Number(args.fromSec),
        toSec: Number(args.toSec),
      });
      break;
    case 'episode_info':
      result = episodeInfo({ recordId: String(args.recordId ?? '') });
      break;
    default:
      result = { error: `unknown tool "${name}"` };
  }
  const ms = Date.now() - started;
  return { name, args, ms, result, payload: truncate(JSON.stringify(result), 14000) };
}

export function summarizeToolResult(name, result) {
  if (!result || typeof result !== 'object') return '';
  if (result.error) return `error: ${result.error}`;
  if (name === 'search_corpus') return `${(result.hits || []).length} hits`;
  if (name === 'moments_for_passage') return `${(result.moments || []).length} of ${result.total ?? 0} moments`;
  if (name === 'transcript_window') return `${result.fromSec}s–${result.toSec}s of ${result.title || ''}`;
  if (name === 'episode_info') return `${result.title || ''} (${result.durationSec || 0}s)`;
  if (name === 'list_sources') return `${(result.sources || []).length} shows`;
  return '';
}
