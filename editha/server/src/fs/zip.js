import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
const deflateRaw = promisify(zlib.deflateRaw);
/** zlib.crc32 c'è da Node 22.2 (nativo, molto più veloce); altrimenti la versione in JS. */
const nativeCrc32 = zlib.crc32;
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
export function crc32(data) {
    if (nativeCrc32)
        return nativeCrc32(data) >>> 0;
    return crc32js(data);
}
export function crc32js(data) {
    let crc = 0xffffffff;
    for (const byte of data)
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}
/**
 * Nome sicuro dentro l'archivio: "\" e ":" diventano "_" (su Windows sarebbero separatori
 * o unità e un nome come "..\x" uscirebbe dalla cartella di estrazione).
 */
export function zipEntryName(name) {
    return name.replace(/[\\:]/g, '_');
}
/**
 * Archivio ZIP in memoria (deflate), senza dipendenze esterne. Basta per le
 * cartelle di configurazione: chi chiama limita la dimensione totale. La compressione
 * è asincrona (thread di libuv), così il server non resta fermo per secondi.
 */
export async function createZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(zipEntryName(entry.name), 'utf8');
        const compressed = await deflateRaw(entry.data);
        const stored = compressed.length >= entry.data.length;
        const body = stored ? entry.data : compressed;
        const method = stored ? 0 : 8;
        const crc = crc32(entry.data);
        const { time, date } = dosDateTime(entry.mtime);
        // Bit 11: nomi in UTF-8.
        const flags = 0x0800;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, body);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + body.length;
    }
    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}
