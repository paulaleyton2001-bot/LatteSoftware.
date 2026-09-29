-- ==========================================================================
-- 0003_card_terminal_provider.sql
--
-- Aplica `CARD_TERMINAL` (el datáfono del local) como valor legal de
-- `payments.provider`.
--
-- ==========================================================================
-- EL HUECO DE CONTRATO QUE CORRIGE
-- ==========================================================================
-- `0001_init.sql` congeló este CHECK:
--
--   CONSTRAINT ck_payments_provider
--     CHECK (provider IS NULL OR provider IN
--            ('CASH_REGISTRY','STRIPE','MERCADOPAGO','WOMPI','PAYU'));
--
-- Esos cinco valores son TODOS de pasarela ONLINE. El sistema, sin embargo, no
-- tiene ninguna pasarela: se cobra en el mostrador, en efectivo o con datáfono.
-- Para el datáfono no había valor posible, así que el módulo de pagos se vio
-- obligado a registrar el cobro con tarjeta como `provider = NULL` y a colgar
-- la identificación del aparato del `provider_reference` (nº de aprobación).
--
-- Con esta migración el valor que el contrato describe EXISTE: el cajero declara
-- `provider = 'CARD_TERMINAL'` y el `provider_reference` sigue siendo la
-- aprobación opaca, que es lo que permite conciliar contra el extracto.
--
-- ==========================================================================
-- POR QUÉ HACE FALTA RECREAR LA TABLA
-- ==========================================================================
-- SQLite no tiene `ALTER TABLE ... DROP CONSTRAINT`. La única forma de cambiar
-- un CHECK es recrear la tabla, y una recreación mal hecha pierde el esquema
-- entero de esa tabla: los índices (uno de ellos UNIQUE y PARCIAL sobre una
-- expresión), el trigger, el AUTOINCREMENT y las claves foráneas ajenas que
-- apuntan a ella. Por eso todo lo que no vive dentro del `CREATE TABLE` se
-- reconstruye a mano, en orden, y al final se comprueba.
--
-- ==========================================================================
-- POR QUÉ ESTA MIGRACIÓN NO PUEDE USAR EL PROCEDIMIENTO OFICIAL
-- ==========================================================================
-- El procedimiento de 12 pasos de la documentación de SQLite empieza así:
--
--     PRAGMA foreign_keys = OFF;   -- 1
--     BEGIN;                       -- 2
--     CREATE TABLE payments_new (...); ...
--     COMMIT;                      -- 11
--     PRAGMA foreign_keys = ON;    -- 12
--
-- Aquí los pasos 1 y 2 son IMPOSIBLES, y no es una incomodidad sino una
-- restricción dura del runner (`shared/database/migrator.ts`), que abre
-- `BEGIN IMMEDIATE` y ejecuta el fichero con `db.exec` DENTRO de esa
-- transacción, precisamente para que una migración entre entera o no entre
-- nada:
--
--   - `PRAGMA foreign_keys` es un PRAGMA **inocuo dentro de una transacción**:
--     SQLite lo ignora mientras haya un `BEGIN` o un `SAVEPOINT` pendiente. Se
--     puede comprobar: puesto a `OFF` entre `BEGIN IMMEDIATE` y `COMMIT`, la
--     lectura sigue devolviendo `1`. La conexión además abre con
--     `foreign_keys = ON` (`shared/database/connection.ts`), de modo que la
--     afirmación está activa durante toda la migración y no hay forma de
--     apagarla desde aquí.
--   - `PRAGMA legacy_alter_table = ON` tampoco sirve de salida, que es la
--     primera razón por la que se descartó el renombrado de la tabla vieja.
--     En el modo legacy (`ON`) un `ALTER TABLE ... RENAME` NO reescribe las
--     referencias ajenas; con `foreign_keys = ON` SÍ las reescribe igual, porque
--     SQLite tiene que mantener la integridad mientras renombra. Medido sobre
--     este esquema: tras `ALTER TABLE payments RENAME TO payments_pre_0003` con
--     `legacy_alter_table = 1`, el DDL de `payment_refunds` queda diciendo
--     `REFERENCES "payments_pre_0003"(id)`, y al borrar la tabla antigua esa
--     clave foránea queda APUNTANDO A UNA TABLA QUE YA NO EXISTE.
--   - `PRAGMA defer_foreign_keys = ON` tampoco ayuda: `RESTRICT` se evalúa en el
--     momento de la fila, no se aplaza al commit. Medido: `DROP TABLE` de un
--     padre con un hijo `ON DELETE RESTRICT` sigue fallando con
--     `FOREIGN KEY constraint failed`.
--
-- ==========================================================================
-- LA SECUENCIA QUE SÍ FUNCIONA CON LAS FK ACTIVAS
-- ==========================================================================
-- La pieza clave es que `payment_refunds.payment_id` es la ÚNICA clave foránea
-- del esquema que apunta a `payments`, y que es `ON DELETE RESTRICT`. Y que el
-- `DROP TABLE` de SQLite hace un `DELETE FROM` implícito de la tabla que borra,
-- que es justo lo que choca con ese `RESTRICT`. Con la hija VACÍA, ese
-- `DELETE FROM` no encuentra nadie y la tabla se puede borrar con las FK
-- encendidas (medido: mismo `DROP TABLE`, con la hija vacía, sin error).
--
-- De ahí la secuencia, en este orden y no en otro:
--
--   1. Se vuelca `payment_refunds` a una tabla TEMPORAL y se vacía la tabla
--      real. Se vacía, NO se borra: la tabla conserva su ESQUEMA entero, sus
--      índices, sus CHECK y su `FOREIGN KEY (payment_id) REFERENCES
--      payments(id)`. Al final sólo se reinserta lo que había.
--   2. Se sueltan los índices y el trigger de `payments` (un `DROP TABLE` se
--      los llevaría, y `sqlite_autoindex_payments_1` lo regenera solo el
--      `CREATE TABLE` porque viene del `UNIQUE (payment_number)`).
--   3. Se crea `payments_0003_new` con el CHECK nuevo y se copian las filas con
--      sus `id`. La tabla nueva tiene OTRO NOMBRE, y por eso en este punto no
--      hay que renombrar nada: ninguna clave ajena puede ser reescrita por
--      error, que era exactamente el fallo del primer intento.
--   4. `DROP TABLE payments`: la única hija (`payment_refunds`) está vacía del
--      paso 1, así que su `DELETE FROM` implícito no viola el `RESTRICT`. Las
--      filas que importan ya están copiadas en el paso 3. Ojo: este `DROP`
--      borra también la fila que `payments` tenía en `sqlite_sequence`.
--   5. `ALTER TABLE payments_0003_new RENAME TO payments`. SQLite reescribe lo
--      que SÍ debe reescribir: el nombre de la tabla en sus propios índices y
--      el de la entrada de `sqlite_sequence` de su AUTOINCREMENT. No toca
--      `payment_refunds`, porque su clave foránea sigue diciendo `payments`,
--      que es el nombre que acaba de recuperar la tabla. Por eso los índices y
--      el trigger se crean DESPUÉS del renombrado, con su DDL final y sin
--      depender de esa reescritura.
--   6. Se arregla `sqlite_sequence` para que el AUTOINCREMENT no se reinicie.
--      Va DESPUÉS del `DROP` y del renombrado, que es cuando el nombre vale
--      otra vez: ponerlo antes se pierde, porque `DROP TABLE` borra la fila.
--   7. Se devuelven a `payment_refunds` sus filas, con los mismos `id` y el
--      mismo `created_at`, y se comprueba que su `FOREIGN KEY` sigue apuntando
--      a `payments`.
--
-- Al terminar, la tabla que se llama `payments` es la nueva, tiene las mismas
-- filas con los mismos `id`, sus seis índices, su trigger, su secuencia y sus
-- cuatro claves foráneas, y `payment_refunds` conserva las suyas y vuelve a
-- apuntar a `payments`. `PRAGMA foreign_key_check` da cero violaciones.
--
-- ==========================================================================
-- AUTOGUARDA
-- ==========================================================================
-- Las cuatro últimas sentencias NO son decorativas. Cada `INSERT` en
-- `_0003_guard` tiene su propio `CHECK (ok = 1)`, así que si al terminar
-- quedara una fila huérfana, una secuencia desfasada, un pago perdido o un
-- reembolso perdido, el `INSERT` falla, el runner hace `ROLLBACK` y la base se
-- queda con el CHECK viejo. Es preferible a que `payments` se quede a medias.
--
-- El runner controla la transacción: prohibido BEGIN/COMMIT/ROLLBACK/SAVEPOINT.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Foto de los hechos y desarme de la única clave foránea que estorba.
-- --------------------------------------------------------------------------
CREATE TEMP TABLE _0003_expected (
  payments_rows   INTEGER NOT NULL,
  payments_amount INTEGER NOT NULL,
  refunds_rows    INTEGER NOT NULL,
  refunds_amount  INTEGER NOT NULL
);
INSERT INTO _0003_expected (
  payments_rows, payments_amount, refunds_rows, refunds_amount
)
SELECT
  (SELECT COUNT(*) FROM payments),
  (SELECT COALESCE(SUM(amount_minor), 0) FROM payments),
  (SELECT COUNT(*) FROM payment_refunds),
  (SELECT COALESCE(SUM(amount_minor), 0) FROM payment_refunds);

-- La foto de los hijos, INCLUDING todas sus columnas, en una tabla TEMPORAL.
-- `AS SELECT` crea la tabla sin restricciones: es un volcado puro, y las
-- restricciones de `payment_refunds` se siguen aplicando al reinsertar, porque
-- se reinserta en la tabla REAL, que no se ha tocado.
CREATE TEMP TABLE _0003_refunds AS SELECT * FROM payment_refunds;

-- La tabla se VACÍA, no se borra: conserva columnas, CHECK y
-- `FOREIGN KEY (payment_id) REFERENCES payments(id)`.
DELETE FROM payment_refunds;

-- --------------------------------------------------------------------------
-- 2. Lo que un `DROP TABLE` se llevaría por delante.
-- --------------------------------------------------------------------------
-- `sqlite_autoindex_payments_1` NO se toca: es interno del
-- `UNIQUE (payment_number)` de la propia tabla y lo regenera el `CREATE TABLE`.
DROP TRIGGER IF EXISTS trg_payments_updated_at;
DROP INDEX IF EXISTS ux_payments_idempotency;
DROP INDEX IF EXISTS idx_payments_order;
DROP INDEX IF EXISTS idx_payments_status;
DROP INDEX IF EXISTS idx_payments_method;
DROP INDEX IF EXISTS idx_payments_customer;
DROP INDEX IF EXISTS idx_payments_approved;

-- --------------------------------------------------------------------------
-- 3. La tabla nueva, con OTRO NOMBRE.
-- --------------------------------------------------------------------------
-- Mismas columnas, mismo orden, mismos tipos, mismos `DEFAULT` y las mismas
-- siete restricciones que en `0001_init.sql`. La ÚNICA diferencia es un valor
-- más en la lista de `ck_payments_provider`:
--
--     (...'CASH_REGISTRY','CARD_TERMINAL','STRIPE',...)
--
-- `CARD_TERMINAL` va justo detrás de `CASH_REGISTRY` porque las dos cosas son
-- el cobro del propio local, y las cuatro pasarelas online van detrás.
CREATE TABLE payments_0003_new (
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
  CONSTRAINT ck_payments_provider CHECK (provider IS NULL OR provider IN ('CASH_REGISTRY','CARD_TERMINAL','STRIPE','MERCADOPAGO','WOMPI','PAYU')),
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

-- 3.1. Copia íntegra, `id` incluidos y en el mismo orden. Las columnas se
-- listan una a una (y no `SELECT *`) para que un cambio futuro de orden en el
-- DDL no se cuele como un `id` descolocado.
INSERT INTO payments_0003_new (
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
-- 4. Fuera la tabla vieja. Aquí es legal gracias al paso 1.
-- --------------------------------------------------------------------------
-- Efecto secundario que importa y que se mide en el paso 6: `DROP TABLE`
-- BORRA la fila que esa tabla tenía en `sqlite_sequence`, así que es aquí donde
-- hay que arreglar la secuencia, no antes.
DROP TABLE payments;

-- --------------------------------------------------------------------------
-- 5. La nueva ocupa el nombre bueno.
-- --------------------------------------------------------------------------
-- SQLite renombra también la entrada de `sqlite_sequence` que acompaña al
-- `AUTOINCREMENT` de la tabla, así que a partir de aquí la tabla buena se
-- llama `payments` en TODOS los sitios, `sqlite_sequence` incluido.
ALTER TABLE payments_0003_new RENAME TO payments;

-- --------------------------------------------------------------------------
-- 6. `AUTOINCREMENT` de verdad, y aquí es donde tiene que ser.
-- --------------------------------------------------------------------------
-- El `INSERT ... SELECT` del paso 3 ya dejó `sqlite_sequence` en el `MAX(id)`
-- copiado, pero se pone explícito para no depender de ese detalle de
-- implementación de SQLite: si mañana se añadiera una fila con `id` menor que el
-- máximo, o una tabla VACÍA quedara con `seq = 0` (el siguiente `id` será 1) en
-- vez de sin fila, la diferencia se nota.
DELETE FROM sqlite_sequence WHERE name IN ('payments', 'payments_0003_new');
INSERT INTO sqlite_sequence (name, seq)
SELECT 'payments', COALESCE(MAX(id), 0) FROM payments;

-- --------------------------------------------------------------------------
-- 7. Los seis índices y el trigger, con el DDL literal de `0001_init.sql`.
-- --------------------------------------------------------------------------
-- Se crean DESPUÉS del renombrado a propósito: así su texto lleva ya el nombre
-- final y no depende de que SQLite reescriba el DDL de un índice al renombrar.
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
FROM _0003_refunds;

-- --------------------------------------------------------------------------
-- 9. Autoguardas. Cada `INSERT` viola su propio CHECK si la comprobación falla.
-- --------------------------------------------------------------------------
CREATE TEMP TABLE _0003_guard (ok INTEGER NOT NULL CHECK (ok = 1));

-- 9.1. Integridad referencial en TODO el esquema. Se comprueba al final, que
-- es cuando la tabla buena ya se llama `payments`: si la clave foránea de
-- `payment_refunds` hubiera quedado apuntando a `payments_0003_new` o a la
-- tabla vieja, aquí saldría.
INSERT INTO _0003_guard (ok)
SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;

-- 9.2. Ningún pago perdido ni inventado, y el mismo dinero.
INSERT INTO _0003_guard (ok)
SELECT CASE WHEN (SELECT COUNT(*) FROM payments) = (SELECT payments_rows FROM _0003_expected)
             AND (SELECT COALESCE(SUM(amount_minor), 0) FROM payments)
               = (SELECT payments_amount FROM _0003_expected)
       THEN 1 ELSE 0 END;

-- 9.3. Ningún reembolso perdido.
INSERT INTO _0003_guard (ok)
SELECT CASE WHEN (SELECT COUNT(*) FROM payment_refunds) = (SELECT refunds_rows FROM _0003_expected)
             AND (SELECT COALESCE(SUM(amount_minor), 0) FROM payment_refunds)
               = (SELECT refunds_amount FROM _0003_expected)
       THEN 1 ELSE 0 END;

-- 9.4. La secuencia de AUTOINCREMENT al día. `sqlite_sequence` no aparece en
-- `pragma_foreign_key_check`, así que se comprueba aparte.
INSERT INTO _0003_guard (ok)
SELECT CASE WHEN (SELECT seq FROM sqlite_sequence WHERE name = 'payments')
              = (SELECT COALESCE(MAX(id), 0) FROM payments)
       THEN 1 ELSE 0 END;

DROP TABLE _0003_guard;
DROP TABLE _0003_refunds;
DROP TABLE _0003_expected;
