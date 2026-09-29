-- ==========================================================================
-- 0003_card_terminal_provider.down.sql — Reversión de
-- 0003_card_terminal_provider.sql
--
-- Operación SIMÉTRICA y exacta, en orden inverso al `up`: se vuelve a recrear
-- `payments` con el CHECK de `0001_init.sql` (los cinco proveedores de pasarela,
-- sin `CARD_TERMINAL`) y se restaura el mismo número de índices, el mismo
-- trigger, la misma secuencia de AUTOINCREMENT, las mismas cuatro claves
-- foráneas y las mismas filas de `payments` y de `payment_refunds`.
--
-- Usa EXACTAMENTE la misma secuencia que el `up`, y por las mismas razones
-- documentadas en él: el runner abre `BEGIN IMMEDIATE` antes de leer este
-- fichero, y dentro de una transacción `PRAGMA foreign_keys` es inocuo, así que
-- no se puede apagar la afirmación de FK. Por eso los reembolsos se vuelcan a
-- una tabla TEMPORAL y se reinsertan, para que el `DROP TABLE` de `payments`
-- encuentre a su única hija `ON DELETE RESTRICT` vacía y pueda borrarla sin
-- conflicto.
--
-- --------------------------------------------------------------------------
-- ADVERTENCIA: REVIERTE UN VALOR, NO UN DATO PERDIDO
-- --------------------------------------------------------------------------
-- Si algún pago tiene `provider = 'CARD_TERMINAL'`, este `down` NO puede
-- deshacerlo sin mentir: la copia falla con `CHECK constraint failed:
-- ck_payments_provider`, la autoguarda lo detecta y el runner revierte la
-- reversión entera, dejando el esquema como estaba. Es el comportamiento
-- correcto, no un fallo del fichero. Para revertir hay que devolver antes esos
-- pagos a un valor del CHECK viejo:
--
--   UPDATE payments SET provider = NULL
--    WHERE provider = 'CARD_TERMINAL' AND method = 'CARD';
--
-- que es además el estado en el que el módulo de pagos dejaba el cobro con
-- datáfono antes de esta migración (`provider_reference` sigue siendo el número
-- de aprobación, así que no se pierde información), y reejecutar
-- `npm run migrate:rollback`.
--
-- El runner controla la transacción: prohibido BEGIN/COMMIT/ROLLBACK/SAVEPOINT.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Foto de los hechos y desarme de la única clave foránea que estorba.
-- --------------------------------------------------------------------------
CREATE TEMP TABLE _0003_down_expected (
  payments_rows   INTEGER NOT NULL,
  payments_amount INTEGER NOT NULL,
  refunds_rows    INTEGER NOT NULL,
  refunds_amount  INTEGER NOT NULL
);
INSERT INTO _0003_down_expected (
  payments_rows, payments_amount, refunds_rows, refunds_amount
)
SELECT
  (SELECT COUNT(*) FROM payments),
  (SELECT COALESCE(SUM(amount_minor), 0) FROM payments),
  (SELECT COUNT(*) FROM payment_refunds),
  (SELECT COALESCE(SUM(amount_minor), 0) FROM payment_refunds);

CREATE TEMP TABLE _0003_down_refunds AS SELECT * FROM payment_refunds;
DELETE FROM payment_refunds;

-- --------------------------------------------------------------------------
-- 2. Lo que un `DROP TABLE` se llevaría por delante.
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_payments_updated_at;
DROP INDEX IF EXISTS ux_payments_idempotency;
DROP INDEX IF EXISTS idx_payments_order;
DROP INDEX IF EXISTS idx_payments_status;
DROP INDEX IF EXISTS idx_payments_method;
DROP INDEX IF EXISTS idx_payments_customer;
DROP INDEX IF EXISTS idx_payments_approved;

-- --------------------------------------------------------------------------
-- 3. `payments` con el DDL ORIGINAL de `0001_init.sql`: mismas columnas, mismo
--    orden, mismos DEFAULT, mismas siete restricciones y el
--    `ck_payments_provider` de cinco valores, sin `CARD_TERMINAL`.
-- --------------------------------------------------------------------------
CREATE TABLE payments_0003_down_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id         INTEGER NOT NULL,
  order_id            INTEGER,
  payment_number      TEXT NOT NULL,
  method              TEXT NOT NULL,
  provider            TEXT,
  provider_reference  TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  amount_minor        INTEGER NOT NULL,
  refunded_minor      INTEGER NOT NULL DEFAULT 0,
  currency_code       TEXT NOT NULL DEFAULT 'COP',
  reference_number    TEXT,
  receipt_number      TEXT,
  notes               TEXT,
  processed_by        INTEGER,
  customer_id         INTEGER,
  approved_at         TEXT,
  failed_at           TEXT,
  failure_reason      TEXT,
  metadata            TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_payments_payment_number UNIQUE (payment_number),
  CONSTRAINT ck_payments_method CHECK (method IN ('CASH','CARD','TRANSFER','ONLINE')),
  CONSTRAINT ck_payments_provider CHECK (provider IS NULL OR provider IN ('CASH_REGISTRY','STRIPE','MERCADOPAGO','WOMPI','PAYU')),
  CONSTRAINT ck_payments_status CHECK (status IN ('PENDING','APPROVED','FAILED','REFUNDED','PARTIALLY_REFUNDED','CANCELLED')),
  CONSTRAINT ck_payments_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_payments_refunded CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor),
  CONSTRAINT ck_payments_metadata CHECK (metadata IS NULL OR json_valid(metadata)),
  -- Un pago no se borra nunca: RESTRICT sobre el pedido.
  FOREIGN KEY (business_id)  REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id)     REFERENCES orders(id)     ON DELETE RESTRICT,
  FOREIGN KEY (processed_by) REFERENCES users(id)      ON DELETE SET NULL,
  FOREIGN KEY (customer_id)  REFERENCES users(id)      ON DELETE SET NULL
);

-- 3.1. Copia íntegra con los mismos `id`. Si algún pago usa `CARD_TERMINAL`,
--     el CHECK de la tabla nueva lo rechaza aquí y la reversión se deshace
--     entera, con un error que explica qué hacer.
INSERT INTO payments_0003_down_new (
  id, business_id, order_id, payment_number, method, provider, provider_reference,
  status, amount_minor, refunded_minor, currency_code, reference_number,
  receipt_number, notes, processed_by, customer_id, approved_at, failed_at,
  failure_reason, metadata, created_at, updated_at
)
SELECT
  id, business_id, order_id, payment_number, method, provider, provider_reference,
  status, amount_minor, refunded_minor, currency_code, reference_number,
  receipt_number, notes, processed_by, customer_id, approved_at, failed_at,
  failure_reason, metadata, created_at, updated_at
FROM payments;

-- --------------------------------------------------------------------------
-- 4. Fuera la tabla vieja. Legal gracias al paso 1.
-- --------------------------------------------------------------------------
-- Ojo: este `DROP TABLE` borra también la fila que `payments` tenía en
-- `sqlite_sequence`, así que la secuencia se arregla DESPUÉS, en el paso 6.
DROP TABLE payments;

-- --------------------------------------------------------------------------
-- 5. La nueva ocupa el nombre bueno.
-- --------------------------------------------------------------------------
ALTER TABLE payments_0003_down_new RENAME TO payments;

-- --------------------------------------------------------------------------
-- 6. `AUTOINCREMENT` restaurado al `MAX(id)` copiado.
-- --------------------------------------------------------------------------
DELETE FROM sqlite_sequence WHERE name IN ('payments', 'payments_0003_down_new');
INSERT INTO sqlite_sequence (name, seq)
SELECT 'payments', COALESCE(MAX(id), 0) FROM payments;

-- --------------------------------------------------------------------------
-- 7. Los seis índices y el trigger, con el DDL literal de `0001_init.sql`.
-- --------------------------------------------------------------------------
CREATE INDEX idx_payments_order     ON payments (order_id, created_at DESC);
CREATE INDEX idx_payments_status    ON payments (business_id, status, created_at DESC);
CREATE INDEX idx_payments_method    ON payments (business_id, method, created_at DESC);
CREATE INDEX idx_payments_customer  ON payments (customer_id, created_at DESC);
CREATE INDEX idx_payments_approved  ON payments (business_id, approved_at);

CREATE UNIQUE INDEX ux_payments_idempotency
  ON payments (json_extract(metadata, '$.idempotency_key'))
 WHERE json_extract(metadata, '$.idempotency_key') IS NOT NULL;

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  UPDATE payments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- --------------------------------------------------------------------------
-- 8. Los reembolsos vuelven a su sitio, con los mismos `id`.
-- --------------------------------------------------------------------------
INSERT INTO payment_refunds (
  id, payment_id, order_id, amount_minor, reason, refunded_by, provider_reference, created_at
)
SELECT
  id, payment_id, order_id, amount_minor, reason, refunded_by, provider_reference, created_at
FROM _0003_down_refunds;

-- --------------------------------------------------------------------------
-- 9. Autoguardas, idénticas a las del `up`.
-- --------------------------------------------------------------------------
CREATE TEMP TABLE _0003_down_guard (ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO _0003_down_guard (ok)
SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;

INSERT INTO _0003_down_guard (ok)
SELECT CASE WHEN (SELECT COUNT(*) FROM payments) = (SELECT payments_rows FROM _0003_down_expected)
             AND (SELECT COALESCE(SUM(amount_minor), 0) FROM payments)
               = (SELECT payments_amount FROM _0003_down_expected)
       THEN 1 ELSE 0 END;

INSERT INTO _0003_down_guard (ok)
SELECT CASE WHEN (SELECT COUNT(*) FROM payment_refunds) = (SELECT refunds_rows FROM _0003_down_expected)
             AND (SELECT COALESCE(SUM(amount_minor), 0) FROM payment_refunds)
               = (SELECT refunds_amount FROM _0003_down_expected)
       THEN 1 ELSE 0 END;

INSERT INTO _0003_down_guard (ok)
SELECT CASE WHEN (SELECT seq FROM sqlite_sequence WHERE name = 'payments')
              = (SELECT COALESCE(MAX(id), 0) FROM payments)
       THEN 1 ELSE 0 END;

-- 9.5. La razón de ser del `down`: el CHECK viejo ya no acepta `CARD_TERMINAL`.
-- Si alguien llegara aquí con un pago de datáfono, la copia de arriba ya habría
-- fallado; esta comprobación cierra el círculo para el caso de que el CHECK se
-- cambiara en una migración futura.
INSERT INTO _0003_down_guard (ok)
SELECT CASE WHEN EXISTS (SELECT 1 FROM payments WHERE provider = 'CARD_TERMINAL')
       THEN 0 ELSE 1 END;

DROP TABLE _0003_down_guard;
DROP TABLE _0003_down_refunds;
DROP TABLE _0003_down_expected;
