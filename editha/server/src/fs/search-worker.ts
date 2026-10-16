// Worker di ricerca e sostituzione (SR-1, SR-3): isolato dal server, così può essere fermato a metà.
import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { decodeText, etagOf } from './files.js';
import { replaceInText, searchTree, type ReplaceMessage, type SearchMessage, type SearchOptions } from './search.js';

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
    } catch {
      continue;
    }
    const text = decodeText(data);
    if (text === null) continue;
    const result = replaceInText(text, job.opts, job.replacement, job.maxFileSize);
    if (result === null) post({ type: 'skip', rel, reason: 'too_large' });
    else if (result.count > 0) post({ type: 'file', rel, ...result, etag: etagOf(data) });
  }
  post({ type: 'done' });
} else {
  const post = (msg: SearchMessage) => parentPort!.postMessage(msg);
  const done = await searchTree(job.root, job.opts, job.maxFileSize, (path, matches) =>
    post({ type: 'file', path, matches }),
  );
  post({ type: 'done', ...done });
}
