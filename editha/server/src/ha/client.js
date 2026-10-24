import { EdithaError } from '../errors.js';
/** Attributi che elencano gli stati possibili dell'entità: select/input_select, climate, water_heater. */
const STATE_LISTS = ['options', 'hvac_modes', 'operation_list'];
function possibleStates(attributes) {
    const out = new Set();
    for (const key of STATE_LISTS) {
        const list = attributes[key];
        if (!Array.isArray(list))
            continue;
        for (const v of list)
            if (typeof v === 'string' && v.length <= 100)
                out.add(v);
    }
    return [...out].slice(0, 200);
}
const TIMEOUT_MS = 15_000;
/** Un template che non finisce (cicli enormi) non deve tenere ferma l'anteprima. */
const TEMPLATE_TIMEOUT_MS = 10_000;
/** Il controllo della configurazione può richiedere più tempo su installazioni grandi. */
const CHECK_TIMEOUT_MS = 120_000;
/**
 * Chiamate alle API REST di Home Assistant Core tramite il proxy del Supervisor.
 * Il token resta sul server: il browser non lo vede mai (SEC-6).
 */
export class HaClient {
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    get available() {
        return this.token !== '';
    }
    async call(method, path, body, timeout = TIMEOUT_MS) {
        const { res, text } = await this.send(method, path, body, timeout);
        if (!res.ok) {
            throw new EdithaError('ha_error', `Home Assistant ha risposto con un errore (${res.status})`, {
                status: res.status,
                message: text.slice(0, 500),
            });
        }
        try {
            return (text ? JSON.parse(text) : null);
        }
        catch {
            throw new EdithaError('ha_error', 'Risposta di Home Assistant non valida');
        }
    }
    async send(method, path, body, timeout) {
        if (!this.available) {
            throw new EdithaError('ha_unavailable', 'Home Assistant non è raggiungibile da questa installazione');
        }
        let res;
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${this.token}`,
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                body: body === undefined ? null : JSON.stringify(body),
                signal: AbortSignal.timeout(timeout),
            });
        }
        catch (err) {
            const timedOut = err?.name === 'TimeoutError';
            throw new EdithaError('ha_unavailable', timedOut ? 'Home Assistant non ha risposto in tempo' : 'Impossibile contattare Home Assistant');
        }
        let text;
        try {
            text = await res.text();
        }
        catch {
            throw new EdithaError('ha_unavailable', 'Home Assistant non ha risposto in tempo');
        }
        return { res, text };
    }
    /**
     * HA-7: rende un template con lo stato attuale delle entità (POST /api/template, come in
     * Strumenti per sviluppatori). Gli errori del template tornano come esito, non come eccezione.
     */
    async renderTemplate(template) {
        const { res, text } = await this.send('POST', '/template', { template }, TEMPLATE_TIMEOUT_MS);
        if (res.ok)
            return { ok: true, result: text };
        if (res.status !== 400) {
            throw new EdithaError('ha_error', `Home Assistant ha risposto con un errore (${res.status})`, {
                status: res.status,
                message: text.slice(0, 500),
            });
        }
        // Un 400 senza il messaggio di HA (es. una pagina del proxy) non è un errore del template.
        let message = null;
        try {
            const m = JSON.parse(text)?.message;
            if (typeof m === 'string')
                message = m;
        }
        catch {
            // non è JSON
        }
        if (message === null) {
            throw new EdithaError('ha_error', 'Home Assistant ha risposto con un errore (400)', {
                status: 400,
                message: text.slice(0, 500),
            });
        }
        // HA non indica la riga dell'errore: Jinja la toglie dal messaggio prima che arrivi qui.
        message = message.replace(/^Error rendering template:\s*/, '').trim();
        return {
            ok: false,
            kind: /^TemplateSyntaxError\b/.test(message) ? 'syntax' : 'render',
            message: message.slice(0, 2000),
        };
    }
    async entities() {
        const states = await this.call('GET', '/states');
        return states
            .map((s) => ({
            entity_id: s.entity_id,
            name: typeof s.attributes?.friendly_name === 'string' ? s.attributes.friendly_name : '',
            state: s.state,
            unit: typeof s.attributes?.unit_of_measurement === 'string' ? s.attributes.unit_of_measurement : null,
            attributes: Object.keys(s.attributes ?? {}).slice(0, 200),
            states: possibleStates(s.attributes ?? {}),
        }))
            .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    }
    async services() {
        const domains = await this.call('GET', '/services');
        const out = [];
        for (const d of domains) {
            for (const [name, info] of Object.entries(d.services ?? {})) {
                out.push({
                    id: `${d.domain}.${name}`,
                    name: typeof info.name === 'string' ? info.name : '',
                    description: typeof info.description === 'string' ? info.description : '',
                });
            }
        }
        return out.sort((a, b) => a.id.localeCompare(b.id));
    }
    /** ACT-1: lo stesso controllo di "Verifica configurazione" in HA. */
    async checkConfig() {
        const res = await this.call('POST', '/config/core/check_config', undefined, CHECK_TIMEOUT_MS);
        return {
            valid: res?.result === 'valid',
            errors: res?.errors || null,
            warnings: res?.warnings || null,
        };
    }
    async callService(domain, service, data = {}) {
        await this.call('POST', `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, data);
    }
}
