import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { EdithaError } from '../errors.js';
import { isTempName } from './atomic.js';
import { decodeText } from './files.js';
import { READ_ONLY_DIRS } from './paths.js';
const MAX_MATCHES = 2000;
const MAX_MATCHES_PER_FILE = 200;
const MAX_LINE = 400;
/** Oltre questa lunghezza una riga non viene esaminata tutta (file minificati, dati). */
const MAX_SCAN = 10_000;
export const SEARCH_BUDGET_MS = 8000;
/** File che non vale la pena leggere: database, archivi, immagini. */
/** Cartelle saltate a qualunque profondità. */
const SKIP_DIRS = ['.storage', '.cloud', '.git'];
const SKIP_EXT = /\.(db|db-shm|db-wal|sqlite|sqlite3|zip|gz|tar|tgz|png|jpe?g|gif|webp|ico|bmp|mp3|mp4|wav|pdf|woff2?|ttf|so|pyc)$/i;
/**
 * SEC-7: secrets.yaml e le sue copie non entrano mai nella ricerca né nella sostituzione.
 * "secrets" in qualunque punto del nome, poi ".yaml"/".yml" in qualunque punto: secrets_copia.yaml.bak,
 * secrets.yaml_copy.bak, secrets.yaml~, old_secrets.yaml, 20240101_secrets.yaml, secretsold.yaml,
 * secrets_esphome.yaml (la stessa regola dei dati sensibili di Git). Il singolare "secret" vale
 * solo come copia (secret.yaml, secret_old.yaml), così secret_sensors.yaml resta un file normale.
 */
export function isSecretsFile(name) {
    return (/secrets[^/]*\.ya?ml/i.test(name) ||
        /^[.#~]?secret(?:[._~ -]?(?:\d+|bak|backup|old|orig|copy|copia|new|\(\d+\)))*\.ya?ml/i.test(name));
}
/** Lettere, cifre e "_" (Unicode): ciò che non deve stare attorno a una parola intera. */
const WORD_U = '[\\p{L}\\p{N}_]';
/**
 * Regola esatta della ricerca (la replica anche l'interfaccia):
 * - testo semplice: la query con i caratteri speciali (.*+?^${}()|[]\) preceduti da "\";
 *   con `regex` la query così com'è;
 * - flag "g", più "i" senza `caseSensitive`, più "u" se l'espressione è valida in quella
 *   modalità; altrimenti si riprova senza "u";
 * - `wholeWord`: con "u" `(?<![\p{L}\p{N}_])(?:…)(?![\p{L}\p{N}_])` (lettere accentate
 *   comprese), senza "u" `(?<![\w])(?:…)(?![\w])` (solo ASCII).
 * Un errore di sintassi in entrambe le modalità diventa invalid_request.
 */
export function buildSearchRegExp(opts) {
    const source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = opts.caseSensitive ? 'g' : 'gi';
    try {
        return new RegExp(opts.wholeWord ? `(?<!${WORD_U})(?:${source})(?!${WORD_U})` : source, flags + 'u');
    }
    catch {
        // es. "\-" o "{" non sono ammessi con "u": si usa la modalità classica.
    }
    try {
        return new RegExp(opts.wholeWord ? `(?<![\\w])(?:${source})(?![\\w])` : source, flags);
    }
    catch (err) {
        throw new EdithaError('invalid_request', `Espressione regolare non valida: ${err.message}`);
    }
}
/** Testo UTF-16 ben formato (niente surrogati isolati, che in UTF-8 diventerebbero "\uFFFD"). */
export function isWellFormed(text) {
    return text.isWellFormed();
}
/** Posizione dopo una corrispondenza vuota, come fa String.prototype.replace (con "u" per punti di codice). */
function advance(text, index, unicode) {
    if (!unicode || index + 1 >= text.length)
        return index + 1;
    const c = text.charCodeAt(index);
    if (c < 0xd800 || c > 0xdbff)
        return index + 1;
    const d = text.charCodeAt(index + 1);
    return d >= 0xdc00 && d <= 0xdfff ? index + 2 : index + 1;
}
/**
 * Percorre /config e cerca nei file di testo; ogni file con risultati viene passato
 * subito a `onFile`, così chi aspetta ha i risultati anche se la ricerca va interrotta.
 */
export async function searchTree(root, opts, maxFileSize, onFile) {
    const pattern = buildSearchRegExp(opts);
    let files = 0;
    let total = 0;
    let truncated = false;
    const walk = async (abs, rel) => {
        let dirents;
        try {
            dirents = await readdir(abs, { withFileTypes: true });
        }
        catch {
            return;
        }
        dirents.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
        for (const d of dirents) {
            if (truncated)
                return;
            if (d.isSymbolicLink() || isTempName(d.name))
                continue;
            const childAbs = path.join(abs, d.name);
            const childRel = rel ? `${rel}/${d.name}` : d.name;
            if (d.isDirectory()) {
                // Cartelle di sistema (SEC-8); .storage, .cloud e .git anche più in basso (copie, repository).
                if (rel === '' ? READ_ONLY_DIRS.includes(d.name) : SKIP_DIRS.includes(d.name))
                    continue;
                await walk(childAbs, childRel);
                continue;
            }
            // secrets.yaml e copie (SEC-7): password e chiavi non devono comparire nei risultati.
            if (!d.isFile() || SKIP_EXT.test(d.name) || isSecretsFile(d.name))
                continue;
            let data;
            try {
                if ((await stat(childAbs)).size > maxFileSize)
                    continue;
                data = await readFile(childAbs);
            }
            catch {
                continue;
            }
            const text = decodeText(data);
            if (text === null)
                continue;
            files++;
            const matches = [];
            let fileTotal = 0;
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const full = lines[i].replace(/\r$/, '');
                // Si contano tutte le corrispondenze della riga, come le cambierebbe replaceInText;
                // i dettagli solo per le prime, entro MAX_SCAN caratteri.
                pattern.lastIndex = 0;
                for (let m = pattern.exec(full); m; m = pattern.exec(full)) {
                    if (m[0].length === 0) {
                        pattern.lastIndex = advance(full, pattern.lastIndex, pattern.unicode);
                        continue;
                    }
                    fileTotal++;
                    if (matches.length >= MAX_MATCHES_PER_FILE || m.index + m[0].length > MAX_SCAN)
                        continue;
                    // Nelle righe lunghe si manda la parte attorno alla corrispondenza, non solo l'inizio.
                    const offset = m.index + m[0].length <= MAX_LINE ? 0 : Math.max(0, m.index - 80);
                    matches.push({
                        line: i + 1,
                        column: m.index + 1,
                        length: m[0].length,
                        text: full.slice(offset, offset + MAX_LINE),
                        offset,
                    });
                }
            }
            if (matches.length) {
                onFile(childRel, matches, fileTotal);
                total += matches.length;
                if (total >= MAX_MATCHES)
                    truncated = true;
            }
        }
    };
    await walk(root, '');
    return { files, truncated };
}
/** Interrompe String.replace appena il risultato supera il limite. */
class ReplaceLimit extends Error {
}
/** SR-3: sostituzione in un testo, riga per riga come la ricerca (le corrispondenze sono le stesse). */
export function replaceInText(text, opts, replacement, maxLength = Infinity) {
    const pattern = buildSearchRegExp(opts);
    let count = 0;
    let length = 0;
    const lines = [];
    try {
        for (const line of text.split('\n')) {
            const cr = line.endsWith('\r');
            const body = cr ? line.slice(0, -1) : line;
            // "\n" prima di ogni riga tranne la prima.
            const start = length + (lines.length ? 1 : 0);
            let grow = 0;
            const replaced = body.replace(pattern, (...args) => {
                const match = args[0];
                if (match.length === 0)
                    return match;
                count++;
                const piece = opts.regex ? expandReplacement(replacement, args) : replacement;
                grow += piece.length - match.length;
                // Lunghezza già certa del risultato (la riga fin qui): oltre il limite ci si ferma
                // subito, senza costruire una stringa enorme (es. "$`" ripetuto su una riga lunga).
                const end = args[args.length - (typeof args[args.length - 1] === 'object' ? 3 : 2)] + match.length;
                if (start + end + grow > maxLength)
                    throw new ReplaceLimit();
                return piece;
            });
            lines.push(cr ? replaced + '\r' : replaced);
            // Un risultato oltre il limite dei file non si costruisce nemmeno (memoria del server).
            length = start + replaced.length + (cr ? 1 : 0);
            if (length > maxLength)
                return null;
        }
    }
    catch (err) {
        if (err instanceof ReplaceLimit)
            return null;
        throw err;
    }
    return { content: lines.join('\n'), count };
}
/**
 * Con le espressioni regolari valgono $1…$99, $<nome>, $&, $`, $' e $$ come in JavaScript.
 * Il testo si costruisce dai dati della corrispondenza trovata nella riga intera: rieseguire
 * l'espressione sul solo pezzo trovato sbaglierebbe con lookahead, lookbehind e \b.
 */
export function expandReplacement(template, args) {
    const last = args[args.length - 1];
    const named = typeof last === 'object' && last !== null ? last : null;
    const tail = named ? 3 : 2;
    const groups = args.slice(1, args.length - tail);
    const offset = args[args.length - tail];
    const whole = args[args.length - tail + 1];
    const match = args[0];
    return template.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (token, what, name) => {
        if (what === '$')
            return '$';
        if (what === '&')
            return match;
        if (what === '`')
            return whole.slice(0, offset);
        if (what === "'")
            return whole.slice(offset + match.length);
        if (name !== undefined)
            return named ? (named[name] ?? '') : token;
        const two = Number(what);
        if (two >= 1 && two <= groups.length)
            return groups[two - 1] ?? '';
        const one = Number(what[0]);
        if (what.length === 2 && one >= 1 && one <= groups.length)
            return (groups[one - 1] ?? '') + what[1];
        return token;
    });
}
