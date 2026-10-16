import { css } from 'lit';

/** Stili comuni a tutti i componenti: pulsanti e campi con lo stesso linguaggio visivo. */
export const sharedStyles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  :host {
    font-family: var(--font-ui);
    color: var(--text);
  }
  button {
    font: inherit;
    color: inherit;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .icon-btn.small {
    width: 26px;
    height: 26px;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .icon-btn:active:not(:disabled) {
    background: var(--active);
  }
  .icon-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .icon-btn:focus-visible,
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .btn:hover {
    background: var(--hover);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .btn.primary:hover {
    filter: brightness(1.08);
  }
  .btn.danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
  .btn.danger:hover {
    filter: brightness(1.08);
  }
  .input {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .input.invalid {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-soft);
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 6px;
    flex: none;
  }
`;
