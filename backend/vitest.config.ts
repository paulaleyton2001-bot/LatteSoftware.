/**
 * Configuración de vitest.
 *
 * `include` cubre las dos familias de pruebas del backend:
 *  - `src/<carpeta>/<fichero>.spec.ts`: unitarios de dominio y de utilidades
 *    (`money`, `dates`, máquinas de estado), que viven junto al código que
 *    verifican.
 *  - `tests/<carpeta>/<fichero>.spec.ts`: pruebas de integración HTTP contra la
 *    app completa, con base en memoria, migraciones y semilla (ver
 *    `tests/helpers/harness.ts`).
 *
 * `testTimeout` sube a 30 s porque la primera prueba de un fichero paga el coste
 * de aplicar el esquema completo (34 tablas, sus índices y sus triggers) y la
 * semilla, además de varios hash bcrypt. No es un timeout para un test lento: es
 * el precio de tener la base de verdad.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    // Si una fase siguiente todavía no ha escrito sus tests, `npm test` debe
    // seguir siendo un comando válido.
    passWithNoTests: true,
    reporters: ['default'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Cada fichero corre en su propio contexto de módulos: `config/env.ts` se
    // valida una vez por fichero y el harness puede abrir su base en memoria
    // sin interferir con las demás suites.
    isolate: true,
  },
});
