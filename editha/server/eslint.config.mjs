// Analisi statica: trova errori veri (promesse dimenticate o usate male, await su valori che non
// sono promesse, codice e variabili inutili) senza toccare lo stile. Gira nella CI col typecheck.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.test-dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Una funzione async senza await è legittima quando deve restituire una promessa.
      '@typescript-eslint/require-await': 'off',
      // I valori trasformati in testo arrivano da YAML o dal server e sono sempre semplici
      // (testi, numeri): controllati uno per uno, la regola qui segnala solo falsi allarmi.
      '@typescript-eslint/no-base-to-string': 'off',
      // Parametri non usati ma necessari per la posizione: si chiamano con "_".
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // I metodi async dei componenti Lit (es. firstUpdated) gestiscono da sé i propri errori.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { inheritedMethods: false } }],
    },
  },
);
