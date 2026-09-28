-- ==========================================================================
-- 0002_fix_chair_reservation_index.down.sql — Reversión de
-- 0002_fix_chair_reservation_index.sql
--
-- Operación SIMÉTRICA y exacta, en orden inverso al `up`:
--   1. Se borra el índice de consulta que esta migración creó.
--   2. Se recrea `ux_chair_res_active` con su definición original de
--      `0001_init.sql`.
--
-- ADVERTENCIA: volver atrás RESTAURA UN DEFECTO. `ux_chair_res_active` es único
-- sobre `chair_id` sin mirar la ventana, así que una base con dos reservas
-- `CONFIRMED`/`ACTIVE` no solapadas en la MISMA silla hace que este `CREATE
-- UNIQUE INDEX` falle con `UNIQUE constraint failed`. Si eso ocurre, no es un
-- fallo del `down` sino evidencia de datos que el índice viejo no permitía
-- existir: hay que cancelar o completar las reservas solapadas de esa silla y
-- reejecutar el `rollback`.
--
-- El runner controla la transacción: prohibido BEGIN/COMMIT/ROLLBACK/SAVEPOINT.
-- ==========================================================================

PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_chair_res_overlap_lookup;

-- Definición original de `0001_init.sql`, sin tocar:
--   ux_chair_res_active es UNIQUE sólo por `chair_id` y filtra por estado, de
--   modo que la silla admite una única reserva CONFIRMED/ACTIVE VIVA A LA VEZ en
--   toda la historia, aunque las ventanas no se solapen.
CREATE UNIQUE INDEX IF NOT EXISTS ux_chair_res_active
  ON chair_reservations (chair_id)
 WHERE status IN ('CONFIRMED','ACTIVE');
