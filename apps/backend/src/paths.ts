import { resolve } from 'node:path';
// Misma profundidad desde src/ y dist/. No depende del directorio de ejecución.
export const REPO_ROOT = resolve(__dirname, '../../..');
export const BACKEND_ROOT = resolve(__dirname, '..');
