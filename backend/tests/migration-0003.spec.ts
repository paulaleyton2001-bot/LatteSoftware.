/**
 * REGRESIÓN DE LA MIGRACIÓN `0003_card_terminal_provider`.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE FICHERO
 * ---------------------------------------------------------------------------
 * `0003` es la migración más delicada del proyecto: para cambiar UN valor de un
 * `CHECK`, SQLite obliga a recrear la tabla `payments` entera, y una recreación
 * mal hecha se lleva por delante índices (uno de ellos UNIQUE y PARCIAL sobre una
 * expresión), el trigger de `updated_at`, el `AUTOINCREMENT` y las cuatro claves
 * foráneas. Nada de eso lo cubre la suite de API: las demás pruebas arrancan con
 * el esquema YA migrado, así que pasarían igual con la migración rota.
 *
 * Lo que se fija aquí es la PARIDAD DE ESQUEMA, que es la pregunta correcta:
 * ¿la tabla que sale de la migración se parece a la que entró? Se comparan, con
 * `sqlite_schema`, los índices (con su DDL literal, para que se vea también el
 * `WHERE` del índice parcial), los triggers, las claves foráneas, las columnas y
 * las filas — antes y después.
 *
 * Y se comprueba la SIMETRÍA del `down`: revertir y volver a aplicar tiene que
 * devolver el mismo esquema con el `CARD_TERMINAL` de nuevo admitido.
 *
 * ---------------------------------------------------------------------------
 * AISLAMIENTO
 * ---------------------------------------------------------------------------
 * La conexión es un singleton en memoria y `up()` es idempotente, así que las
 * pruebas comparten base. Cada una empieza igualizing el estado de la migración
 * (arriba `0003`, con `0001` y `0002` aplicadas) y borrando las filas que las
 * pruebas anteriores dejaron en `payments` / `payment_refunds` / `orders` /
 * `users` / `businesses`. Sin esa limpieza, la segunda prueba que siembra un
 * pedido chocaría con el `UNIQUE` de `orders.order_number` de la primera.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import './helpers/test-env.js';

import { getConnection, type Db } from '../src/shared/database/connection.js';
import { listApplied, rollback, up } from '../src/shared/database/migrator.js';

/** Filas de `sqlite_schema` de un tipo, ordenadas, con el DDL normalizado. */
function schemaRows(db: Db, type: string): { readonly name: string; sql: string }[] {
  const rows = db
    .prepare(
      `SELECT name, sql FROM sqlite_schema
        WHERE type = ? AND tbl_name = 'payments' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all(type) as { name: string; sql: string }[];
  return rows.map((row) => ({ name: row.name, sql: (row.sql ?? '').replace(/\s+/g, ' ').trim() }));
}

/** Nombres de columnas de `payments`, en orden. */
function columnsOf(db: Db): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info('payments')`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

/** Filas de `payments`, ordenadas por `id`. */
function paymentRows(db: Db): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM payments ORDER BY id').all() as Record<string, unknown>[];
}

/** Filas de `payment_refunds`, ordenadas por `id`. */
function refundRows(db: Db): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM payment_refunds ORDER BY id').all() as Record<string, unknown>[];
}

/** Valor de `seq` de `payments` en `sqlite_sequence`, o `null`. */
function sequenceOf(db: Db): number | null {
  const row = db
    .prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'payments'`)
    .get() as { seq: number } | undefined;
  return row?.seq ?? null;
}

/** Los valores admitidos por `ck_payments_provider`, en el orden del DDL. */
function providerCheckOf(db: Db): string {
  const table = schemaRows(db, 'table').find((row) => row.name === 'payments');
  const match = /CHECK \(provider IS NULL OR provider IN \(([^)]*)\)\)/.exec(table?.sql ?? '');
  return match?.[1] ?? '';
}

/** Instantánea completa de lo que la migración tiene que preservar. */
interface Snapshot {
  readonly indexes: { name: string; sql: string }[];
  readonly triggers: { name: string; sql: string }[];
  readonly columns: string[];
  readonly payments: Record<string, unknown>[];
  readonly refunds: Record<string, unknown>[];
  readonly sequence: number | null;
  readonly providerCheck: string;
}

function snapshot(db: Db): Snapshot {
  return {
    indexes: schemaRows(db, 'index'),
    triggers: schemaRows(db, 'trigger'),
    columns: columnsOf(db),
    payments: paymentRows(db),
    refunds: refundRows(db),
    sequence: sequenceOf(db),
    providerCheck: providerCheckOf(db),
  };
}

let db: Db;

/** Deja el esquema con las TRES migraciones aplicadas. */
function atLatest(): void {
  // `up()` es idempotente y aplica lo que falte, así que sube desde 0001, desde
  // 0002 o no hace nada si ya estaba todo aplicado.
  up();
  expect(listApplied().at(-1)?.name).toBe('0003_card_terminal_provider.sql');
}

/** Borra todo lo que las pruebas siembran, para que no choque el `UNIQUE`. */
function clearSeededRows(): void {
  db.exec('DELETE FROM payment_refunds');
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM orders');
  db.exec(`DELETE FROM users WHERE email LIKE '%@example.test'`);
  db.exec('DELETE FROM businesses');
  db.exec(`DELETE FROM sqlite_sequence WHERE name = 'payments'`);
}

/**
 * Cierra la base de datos: negocio, pedido, cajero, pagos y reembolsos.
 *
 * @param terminalProvider Proveedor del pago de datáfono. Se puede pasar
 *        `'STRIPE'` para sembrar con un valor que ALSO quepa en el CHECK de
 *        `0001`, que es lo que hace falta en las pruebas que rebijan a ese
 *        esquema: si se sembrara con `'CARD_TERMINAL'`, el propio `INSERT`
 *        reventaría contra el CHECK viejo.
 */
function seedPayments(
  terminalProvider: 'CARD_TERMINAL' | 'STRIPE' = 'CARD_TERMINAL',
): { orderId: number; cashierId: number; paymentIds: number[] } {
  // `payments.business_id` y `orders.business_id` son `ON DELETE CASCADE` sobre
  // `businesses`: sin este padre la siembra falla la FK. El resto de columnas
  // usa los DEFAULT del esquema, que es lo que se quiere — la prueba va de la
  // migración, no de la configuración del negocio.
  const businessId = db
    .prepare(`INSERT INTO businesses (name) VALUES ('LatteCoffe')`)
    .run().lastInsertRowid as number;
  const orderId = db
    .prepare(
      `INSERT INTO orders (business_id, order_number, type, status, total_minor)
       VALUES (?, 'ORD-00000001', 'DINE_IN', 'CONFIRMED', 25000)`,
    )
    .run(businessId).lastInsertRowid as number;
  const cashierId = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ('cajero-mig@example.test', 'x', 'Cajero', 'ACTIVE')`,
    )
    .run().lastInsertRowid as number;

  // Tres pagos que ejercitan los tres caminos del `CHECK`:
  //  - efectivo sin proveedor (NULL), que es el caso normal del mostrador;
  //  - datáfono, que el CHECK viejo NO admite y es lo que la migración añade;
  //  - tarjeta con pasarela online, que no se toca.
  const paymentIds: number[] = [];
  const rows: readonly (readonly [string, string | null, number, string | null])[] = [
    ['CASH', null, 10000, null],
    ['CARD', terminalProvider, 12000, 'APROB-0001'],
    ['CARD', 'STRIPE', 3000, 'pi_abc123'],
  ];
  for (const [method, provider, amount, reference] of rows) {
    paymentIds.push(
      db
        .prepare(
          `INSERT INTO payments
             (business_id, order_id, payment_number, method, provider, provider_reference,
              status, amount_minor, currency_code, processed_by)
           VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?, 'COP', ?)`,
        )
        .run(
          businessId,
          orderId,
          `PAY-${paymentIds.length + 1}`,
          method,
          provider,
          reference,
          amount,
          cashierId,
        ).lastInsertRowid as number,
    );
  }

  // Dos reembolsos: es la tabla hija `ON DELETE RESTRICT` que obliga a vaciar antes
  // de tirar la tabla padre, y la que el `down` tiene que reponer con sus `id`.
  db.prepare(
    `INSERT INTO payment_refunds (payment_id, order_id, amount_minor, reason, refunded_by, created_at)
     VALUES (?, ?, 2000, 'Devolución parcial', ?, '2026-01-02T03:04:05.000Z')`,
  ).run(paymentIds[1] as number, orderId, cashierId);
  db.prepare(
    `INSERT INTO payment_refunds (payment_id, order_id, amount_minor, reason, refunded_by, created_at)
     VALUES (?, ?, 500, 'Ajuste de caja', ?, '2026-01-03T03:04:05.000Z')`,
  ).run(paymentIds[2] as number, orderId, cashierId);

  // El índice UNIQUE PARCIAL se alimenta de `metadata.idempotency_key`: sin una
  // fila con esa clave, su `WHERE` nunca se ejecutaría y la prueba no probaría
  // nada del índice que la migración reconstruye.
  db.prepare(`UPDATE payments SET metadata = ? WHERE id = ?`).run(
    JSON.stringify({ idempotency_key: 'idem-0001' }),
    paymentIds[0] as number,
  );

  return { orderId, cashierId, paymentIds };
}

/** Inserta un pago de datáfono, que sólo es legal con `0003` aplicada. */
function insertTerminalPayment(paymentNumber: string): void {
  db.prepare(
    `INSERT INTO payments (business_id, payment_number, method, provider, status, amount_minor)
     VALUES ((SELECT id FROM businesses LIMIT 1), ?, 'CARD', 'CARD_TERMINAL', 'APPROVED', 7000)`,
  ).run(paymentNumber);
}

beforeEach(() => {
  db = getConnection();
  atLatest();
  clearSeededRows();
});

// ===========================================================================
describe('0003 up: paridad de esquema y datos', () => {
  it('admite CARD_TERMINAL y conserva índices, trigger, FKs, datos y secuencia', () => {
    // Se empieza por el esquema de `0001`, que es el "antes" de la migración.
    rollback();
    const before = snapshot(db);
    // En el esquema viejo `CARD_TERMINAL` NO es legal: es justo lo que arregla.
    expect(before.providerCheck).not.toContain('CARD_TERMINAL');

    // Se siembra con un proveedor que cabe en el CHECK viejo: así el pago existe
    // ANTES de migrar, y la migración tiene algo real que conservar.
    const { orderId, cashierId } = seedPayments('STRIPE');
    const seedBefore = snapshot(db);
    expect(seedBefore.payments).toHaveLength(3);
    expect(seedBefore.refunds).toHaveLength(2);

    up(); // aplica 0003
    const after = snapshot(db);

    // --- El CHECK es lo único que cambia, y cambia como debe.
    expect(after.providerCheck).toContain('CARD_TERMINAL');
    for (const provider of ['CASH_REGISTRY', 'STRIPE', 'MERCADOPAGO', 'WOMPI', 'PAYU']) {
      expect(after.providerCheck).toContain(provider);
    }
    // Y sólo uno más: ni uno menos, ni uno de más.
    expect(after.providerCheck.split(',')).toHaveLength(before.providerCheck.split(',').length + 1);

    // --- Índices: los mismos, con el MISMO DDL (el `WHERE` del parcial incluido).
    expect(after.indexes.map((i) => i.name).sort()).toEqual(before.indexes.map((i) => i.name).sort());
    expect(after.indexes).toEqual(before.indexes);
    // El índice parcial de idempotencia es el que un `DROP TABLE` se llevaría y
    // el que nadie re-crearía por descuido: se comprueba por nombre y por DDL.
    const partial = after.indexes.find((i) => i.name === 'ux_payments_idempotency');
    expect(partial).toBeDefined();
    expect(partial?.sql).toContain('WHERE');
    expect(partial?.sql).toContain('idempotency_key');

    // --- Trigger.
    expect(after.triggers).toEqual(before.triggers);
    expect(after.triggers.map((t) => t.name)).toContain('trg_payments_updated_at');

    // --- Columnas: mismo nombre, mismo orden.
    expect(after.columns).toEqual(before.columns);

    // --- Datos: mismos `id`, mismos importes, mismos reembolsos.
    expect(after.payments).toEqual(seedBefore.payments);
    expect(after.refunds).toEqual(seedBefore.refunds);
    expect(after.payments.map((p) => p['id'])).toEqual([1, 2, 3]);
    expect(after.refunds.map((r) => r['id'])).toEqual([1, 2]);

    // --- AUTOINCREMENT: la secuencia no se reinicia (por eso el id 4 no repite 1).
    expect(after.sequence).toBe(3);
    const nextId = db
      .prepare(
        `INSERT INTO payments (business_id, payment_number, method, status, amount_minor)
         VALUES ((SELECT id FROM businesses LIMIT 1), 'PAY-4', 'CASH', 'APPROVED', 100)`,
      )
      .run().lastInsertRowid;
    expect(nextId).toBe(4);

    // --- La clave foránea de la HIJA sigue apuntando a `payments`. Un `DROP
    // TABLE` mal hecho la deja apuntando a `payments_0003_new` o a una tabla que
    // ya no existe, y eso no lo ve `foreign_key_check` desde la tabla padre.
    const childFk = db
      .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'payment_refunds'`)
      .get() as { sql: string };
    expect(childFk.sql.replace(/\s+/g, ' ')).toMatch(
      /FOREIGN KEY \(payment_id\) REFERENCES "?payments"?\(id\)/,
    );
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // Y el `RESTRICT` sigue vigente: un pago con reembolsos no se puede borrar.
    expect(() => db.prepare('DELETE FROM payments WHERE id = 2').run()).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
    expect(orderId).toBeGreaterThan(0);
    expect(cashierId).toBeGreaterThan(0);
  });

  it('el CHECK nuevo ACEPTA un pago de datáfono y el viejo lo rechaza', () => {
    // Sin `CARD_TERMINAL` en la siembra, para que la reversión de más abajo no
    // choque con el propio guardián del `down`.
    seedPayments('STRIPE');
    const terminalId = db
      .prepare(
        `INSERT INTO payments (business_id, payment_number, method, provider, status, amount_minor)
         VALUES ((SELECT id FROM businesses LIMIT 1), 'PAY-TERM', 'CARD', 'CARD_TERMINAL', 'APPROVED', 7000)`,
      )
      .run().lastInsertRowid;
    expect(paymentRows(db).some((p) => p['provider'] === 'CARD_TERMINAL')).toBe(true);

    // Se retira antes de revertir: con un `CARD_TERMINAL` en la tabla el `down`
    // rehúsa hacer su trabajo, que es lo que prueba el test siguiente.
    db.prepare('DELETE FROM payments WHERE id = ?').run(terminalId);

    rollback(); // vuelve al CHECK de cinco valores
    expect(providerCheckOf(db)).not.toContain('CARD_TERMINAL');
    // El mismo `INSERT` que antes entraba ahora es rechazado por el CHECK.
    expect(() => insertTerminalPayment('PAY-TERM-2')).toThrow(/CHECK constraint failed/i);
  });

  it('la reversión aborta y NO deja la tabla a medias si hay un pago de datáfono', () => {
    seedPayments();
    // Un pago que SÍ usa `CARD_TERMINAL`: el `down` no puede deshacerlo sin
    // mentir, así que tiene que fallar entero y dejar el esquema como estaba.
    insertTerminalPayment('PAY-TERM');
    const before = snapshot(db);

    expect(() => rollback()).toThrow(/ck_payments_provider/);
    const after = snapshot(db);
    expect(after.indexes).toEqual(before.indexes);
    expect(after.triggers).toEqual(before.triggers);
    expect(after.columns).toEqual(before.columns);
    expect(after.providerCheck).toBe(before.providerCheck);
    expect(after.payments).toEqual(before.payments);
    expect(after.refunds).toEqual(before.refunds);
    expect(after.sequence).toBe(before.sequence);
    // La reversión fallida no se registró: 0003 sigue en pie.
    expect(listApplied().at(-1)?.name).toBe('0003_card_terminal_provider.sql');
    expect(paymentRows(db).some((p) => p['provider'] === 'CARD_TERMINAL')).toBe(true);
  });
});

// ===========================================================================
describe('0003 down: simetría exacta', () => {
  it('revertir devuelve el esquema de 0001 sin perder nada, y reaplicar lo reconstruye', () => {
    const withNew = snapshot(db);
    expect(withNew.providerCheck).toContain('CARD_TERMINAL');

    // Se siembra con el esquema nuevo. El pago de datáfono va con `STRIPE` a
    // propósito: el `down` RECHAZA revertir si queda un `CARD_TERMINAL` (eso es
    // justo lo que prueba el test siguiente), y aquí lo que se prueba es que la
    // reversión es simétrica cuando no hay nada que perder.
    seedPayments('STRIPE');
    const seeded = snapshot(db);

    // ---- down: vuelve al CHECK de cinco valores, con el resto intacto.
    rollback();
    const reverted = snapshot(db);
    expect(reverted.providerCheck).not.toContain('CARD_TERMINAL');
    expect(reverted.indexes).toEqual(withNew.indexes);
    expect(reverted.triggers).toEqual(withNew.triggers);
    expect(reverted.columns).toEqual(withNew.columns);
    expect(reverted.payments).toEqual(seeded.payments);
    expect(reverted.refunds).toEqual(seeded.refunds);
    expect(reverted.sequence).toBe(3);

    // ---- up otra vez: reconstruye EXACTAMENTE el esquema de la primera vez.
    up();
    const reApplied = snapshot(db);
    expect(reApplied.indexes).toEqual(withNew.indexes);
    expect(reApplied.triggers).toEqual(withNew.triggers);
    expect(reApplied.columns).toEqual(withNew.columns);
    expect(reApplied.providerCheck).toBe(withNew.providerCheck);
    expect(reApplied.payments).toEqual(seeded.payments);
    expect(reApplied.refunds).toEqual(seeded.refunds);
    expect(reApplied.sequence).toBe(3);
  });
});
