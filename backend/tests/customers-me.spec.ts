/**
 * Regresión de `GET /api/v1/customers/me` para cuentas de personal.
 *
 * El bug: una cuenta de personal (ADMIN, CASHIER, MANAGER, OWNER, STAFF) recibía
 * `404 NOT_FOUND_ERROR` con el mensaje «El cliente no existe» porque el service
 * buscaba la fila filtrando por el rol `CUSTOMER` y, al no encontrarla, la
 * traducía a "no existe". El usuario SÍ existe: lo que no existe es su ficha en
 * el directorio de clientes.
 *
 * Contrato fijado aquí (regresión, para que nadie lo revierta sin）：
 *  - 200 para TODO usuario autenticado, con `hasCustomerProfile` explícito.
 *  - 200 con la ficha COMPLETA y `hasCustomerProfile: true` para un cliente real.
 *  - El id sale SIEMPRE del token: `customerId` o `id` en la query se ignoran.
 *  - 401 sin token (sigue siendo un endpoint `autenticado`, no público).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Role } from '../src/shared/domain/index.js';
import {
  createTestContext,
  VALID_TEST_PASSWORD,
  type TestContext,
} from './helpers/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx.close();
});

/** Crea un cliente registrado por la API y devuelve `{ id, email, token }`. */
async function registerCustomer(prefix: string): Promise<{
  id: number;
  email: string;
  token: string;
}> {
  const email = ctx.uniqueEmail(prefix);
  const response = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Me' })
    .expect(201);
  return {
    id: Number(response.body.data.user.id),
    email,
    token: String(response.body.data.accessToken),
  };
}

/** Crea una cuenta de personal con un rol dado y devuelve `{ id, email, token }`. */
async function loginStaff(
  role: Role,
  prefix: string,
): Promise<{ id: number; email: string; token: string }> {
  const email = ctx.uniqueEmail(prefix);
  const id = ctx.createUser({ email, fullName: `Personal ${role}`, roles: [role] });
  const login = await ctx.login(email, VALID_TEST_PASSWORD);
  return { id, email, token: login.accessToken };
}

describe('GET /api/v1/customers/me con una cuenta de personal', () => {
  // Los cinco roles de personal que enumera el enunciado del bug. `STAFF` no está
  // en la semilla de despliegue, así que se crea aquí.
  const staffRoles: readonly Role[] = [
    Role.OWNER,
    Role.ADMIN,
    Role.MANAGER,
    Role.CASHIER,
    Role.STAFF,
  ];

  for (const role of staffRoles) {
    it(`${role} recibe 200 con su perfil y hasCustomerProfile: false`, async () => {
      const staff = await loginStaff(role, `me-staff-${role.toLowerCase()}`);

      const response = await ctx.get('/api/v1/customers/me', staff.token).expect(200);

      expect(response.body.success).toBe(true);
      // El perfil del usuario sí se devuelve: nombre, correo y estado son suyos.
      expect(response.body.data.id).toBe(staff.id);
      expect(response.body.data.email).toBe(staff.email);
      expect(response.body.data.fullName).toBe(`Personal ${role}`);
      expect(response.body.data.status).toBe('ACTIVE');
      expect(response.body.data.roles).toContain(role);
      // Y el indicador explícito de que no hay ficha de cliente.
      expect(response.body.data.hasCustomerProfile).toBe(false);
      // Sin ficha de cliente tampoco hay historial que mostrar: ceros, no un error.
      expect(response.body.data.stats).toMatchObject({
        totalOrders: 0,
        totalSpentMinor: 0,
        totalReservations: 0,
        activeReservations: 0,
        activeRentals: 0,
      });
      // El mensaje de error del bug no puede aparecer en un 200.
      expect(JSON.stringify(response.body)).not.toContain('El cliente no existe');
    });
  }

  it('las cuentas de sistema sembradas (admin, cajero, gerente, owner) también: 200', async () => {
    for (const role of [Role.OWNER, Role.ADMIN, Role.MANAGER, Role.CASHIER] as const) {
      const token = await ctx.accessTokenFor(role);
      const response = await ctx.get('/api/v1/customers/me', token).expect(200);
      expect(response.body.data.hasCustomerProfile).toBe(false);
      expect(response.body.data.email).toContain('@lattecoffe.co');
    }
  });

  it('el personal NO aparece en el directorio de clientes ni recibe perfil de cliente', async () => {
    const staff = await loginStaff(Role.CASHIER, 'me-directorio');
    const listado = await ctx.get('/api/v1/customers?pageSize=100', staff.token).expect(200);
    const ids = (listado.body.data as { id: number }[]).map((row) => row.id);
    expect(ids).not.toContain(staff.id);

    // `/customers/:id` sobre sí mismo sigue siendo 404: no es cliente. El 404
    // aquí SÍ es correcto, porque lo que se pide es la ficha del directorio.
    const porId = await ctx.get(`/api/v1/customers/${staff.id}`, staff.token).expect(404);
    expect(porId.body.error.code).toBe('NOT_FOUND_ERROR');
  });
});

describe('GET /api/v1/customers/me con un cliente real', () => {
  it('sigue devolviendo su ficha completa, ahora con hasCustomerProfile: true', async () => {
    const cliente = await registerCustomer('me-cliente');

    const response = await ctx.get('/api/v1/customers/me', cliente.token).expect(200);

    expect(response.body.data.hasCustomerProfile).toBe(true);
    expect(response.body.data.id).toBe(cliente.id);
    expect(response.body.data.email).toBe(cliente.email);
    expect(response.body.data.fullName).toBe('Cliente Me');
    expect(response.body.data.status).toBe('ACTIVE');
    expect(response.body.data.roles).toEqual(['CUSTOMER']);
    // La forma de la ficha no cambia: sigue llegando en la raíz, con sus
    // estadísticas, para no romper al cliente ni al contrato ya publicado.
    expect(response.body.data.stats).toHaveProperty('totalOrders');
    expect(response.body.data.stats).toHaveProperty('totalSpentMinor');
    expect(response.body.data.stats).toHaveProperty('activeReservations');
    expect(response.body.data.stats).toHaveProperty('activeRentals');
    expect(typeof response.body.data.stats.totalOrders).toBe('number');
    expect(typeof response.body.data.createdAt).toBe('string');
    expect(typeof response.body.data.lastLoginAt).toBe('string');
    // Una cuenta recién registrada no ha verificado el correo: `null` es la
    // respuesta correcta y el tipo del campo no cambia.
    expect(response.body.data.emailVerifiedAt === null).toBe(true);
  });

  it('el cliente sigue viendo su propia ficha por `/:id` y no la de otro', async () => {
    const uno = await registerCustomer('me-propio');
    const otro = await registerCustomer('me-otro');

    const propia = await ctx.get(`/api/v1/customers/${uno.id}`, uno.token).expect(200);
    expect(propia.body.data.id).toBe(uno.id);

    // El aislamiento entre clientes se mantiene intacto (404, no 403: API.md 2).
    const ajena = await ctx.get(`/api/v1/customers/${otro.id}`, uno.token).expect(404);
    expect(ajena.body.error.code).toBe('NOT_FOUND_ERROR');
  });
});

describe('El id de /customers/me sale SIEMPRE del token', () => {
  it('ignora `customerId` y `id` en la query', async () => {
    const victima = await registerCustomer('me-victima');
    const atacante = await registerCustomer('me-atacante');

    const response = await ctx
      .get(`/api/v1/customers/me?customerId=${victima.id}&id=${victima.id}`, atacante.token)
      .expect(200);

    expect(response.body.data.id).toBe(atacante.id);
    expect(response.body.data.email).toBe(atacante.email);
    expect(JSON.stringify(response.body)).not.toContain(victima.email);
  });

  it('el personal tampoco puede usarlo para leer la ficha de otro por la query', async () => {
    const victima = await registerCustomer('me-victima-staff');
    const staff = await loginStaff(Role.ADMIN, 'me-admin-intento');

    const response = await ctx
      .get(`/api/v1/customers/me?customerId=${victima.id}`, staff.token)
      .expect(200);

    expect(response.body.data.id).toBe(staff.id);
    expect(response.body.data.hasCustomerProfile).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain(victima.email);
  });
});

describe('Autenticación de /customers/me', () => {
  it('sin token responde 401 AUTHENTICATION_ERROR, no 404 ni 200', async () => {
    const response = await ctx.get('/api/v1/customers/me').expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(response.body.error.details.code).toBe('MISSING_TOKEN');
  });

  it('con token inválido responde 401', async () => {
    const response = await ctx.get('/api/v1/customers/me', 'no.es.un.jwt').expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});
