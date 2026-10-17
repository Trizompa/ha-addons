// Worker di ricerca e sostituzione (SR-1, SR-3): isolato dal server, così può essere fermato a metà.
import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { decodeText, etagOf } from './files.js';
import { fromFsError, EdithaError } from '../errors.js';
import { isWellFormed, replaceInText, searchTree, type ReplaceMessage, type SearchMessage, type SearchOptions } from './search.js';

interface SearchJob {
  mode: 'search';
  root: string;
  opts: SearchOptions;
  maxFileSize: number;
}

interface ReplaceJob {
  mode: 'replace';
  files: { rel: string; abs: string }[];
  opts: SearchOptions;
  replacement: string;
  maxFileSize: number;
}

const job = workerData as SearchJob | ReplaceJob;

if (job.mode === 'replace') {
  const post = (msg: ReplaceMessage) => parentPort!.postMessage(msg);
  for (const { rel, abs } of job.files) {
    let data: Buffer;
    try {
      data = await readFile(abs);
    } catch (err) {
      const mapped = fromFsError(err, rel);
      post({ type: 'skip', rel, reason: mapped instanceof EdithaError ? mapped.code : 'error' });
      continue;
    }
    const text = decodeText(data);
    // Un file che non è testo non sparisce in silenzio dai risultati.
    if (text === null) {
      post({ type: 'skip', rel, reason: 'binary' });
      continue;
    }
    const result = replaceInText(text, job.opts, job.replacement, job.maxFileSize);
    if (result === null) post({ type: 'skip', rel, reason: 'too_large' });
    // Una sostituzione che spezza una coppia di surrogati darebbe "\uFFFD" nel file.
    else if (!isWellFormed(result.content)) post({ type: 'skip', rel, reason: 'encoding' });
    // Contenuto identico (es. "a" → "a"): niente da scrivere, il file non è tra quelli cambiati.
    else if (result.count > 0 && result.content !== text) post({ type: 'file', rel, ...result, etag: etagOf(data) });
  }
  post({ type: 'done' });
} else {
  const post = (msg: SearchMessage) => parentPort!.postMessage(msg);
  const done = await searchTree(job.root, job.opts, job.maxFileSize, (path, matches, total) =>
    post({ type: 'file', path, matches, total }),
  );
  post({ type: 'done', ...done });
}
