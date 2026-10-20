export type ErrorCode =
  | 'invalid_request'
  | 'forbidden_path'
  | 'read_only'
  | 'not_found'
  | 'already_exists'
  | 'conflict'
  | 'not_a_file'
  | 'not_a_directory'
  | 'too_large'
  | 'binary'
  | 'not_previewable'
  | 'ha_unavailable'
  | 'ha_error'
  | 'config_invalid'
  | 'no_space'
  | 'no_backup'
  | 'busy'
  | 'io_error'
  | 'cross_device'
  | 'git_unavailable'
  | 'git_error';

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  forbidden_path: 403,
  read_only: 403,
  not_found: 404,
  already_exists: 409,
  conflict: 409,
  not_a_file: 400,
  not_a_directory: 400,
  too_large: 413,
  binary: 415,
  not_previewable: 415,
  ha_unavailable: 503,
  ha_error: 502,
  config_invalid: 409,
  no_space: 507,
  no_backup: 409,
  busy: 409,
  io_error: 500,
  cross_device: 409,
  git_unavailable: 503,
  git_error: 500,
};

/** Errore previsto, con codice stabile per il frontend. */
export class EdithaError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EdithaError';
    this.status = STATUS[code];
  }
}

/** Traduce gli errori del filesystem più comuni; gli altri vengono rilanciati invariati. */
export function fromFsError(err: unknown, path: string): unknown {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
      return new EdithaError('not_found', `Percorso non trovato: ${path}`, { path });
    case 'EEXIST':
      return new EdithaError('already_exists', `Esiste già: ${path}`, { path });
    // Da rm: la cartella è cambiata durante l'eliminazione (non "esiste già").
    case 'ENOTEMPTY':
    case 'EBUSY':
    case 'EMFILE':
    case 'ENFILE':
      return new EdithaError('busy', `Operazione non riuscita, qualcosa sta usando il percorso: riprova (${path})`, { path });
    case 'EXDEV':
      return new EdithaError('cross_device', `Spostamento tra dischi diversi non supportato: ${path}`, { path });
    case 'EIO':
      return new EdithaError('io_error', `Errore di lettura o scrittura sul disco: ${path}`, { path });
    case 'ENOTDIR':
      return new EdithaError('not_a_directory', `Non è una cartella: ${path}`, { path });
    case 'EISDIR':
      return new EdithaError('not_a_file', `Non è un file: ${path}`, { path });
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new EdithaError('read_only', `Permesso negato: ${path}`, { path });
    case 'ENOSPC':
    case 'EDQUOT':
      return new EdithaError('no_space', 'Spazio esaurito sul disco', { path });
    case 'ENAMETOOLONG':
      return new EdithaError('invalid_request', `Nome troppo lungo: ${path}`, { path });
    case 'ELOOP':
      return new EdithaError('forbidden_path', `Collegamento non valido: ${path}`, { path });
    default:
      return err;
  }
}
