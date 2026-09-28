/**
 * Pruebas de validación de entrada y de límites de tasa (API.md 1, 3.2, 4 y 11.3).
 *
 * A diferencia de las otras dos suites, aquí la app se levanta CON los limitadores
 * ACTIVOS (`createTestContext({ disableRateLimit: false })`): el 429 es parte de lo
 * que hay que probar. Los valores vienen de `tests/helpers/test-env.ts`, que deja
 * `AUTH_PASSWORD_RATE_LIMIT_MAX = 3` y el resto de límites muy altos, de modo que
 * sólo la recuperación de contraseña esté acotada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, TEST_USER_AGENT, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';

let ctx: TestContext;
/** Email inexistente: sirve para gastar cuota sin crear cuentas. */
const inexistente = 'nadie-aqui@example.test';

beforeAll(async () => {
  ctx = await createTestContext({ disableRateLimit: false });
});

afterAll(() => {
  ctx.close();
});

describe('Campos desconocidos (API.md 1: `.strict()`)', () => {
  it('los rechaza en el body con 400 y un detalle por clave', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('desconocido'),
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Desconocido',
        role: 'ADMIN',
        status: 'ACTIVE',
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const details = response.body.error.details as { path: string; code: string; message: string }[];
    const paths = details.map((detail) => detail.path);
    expect(paths).toContain('role');
    expect(paths).toContain('status');
    expect(details.find((detail) => detail.path === 'role')?.code).toBe('UNKNOWN_FIELD');
  });

  it('los rechaza en la query de un listado', async () => {
    const token = await ctx.accessTokenFor('ADMIN');
    const response = await ctx
      .get('/api/v1/users?limite=10&pagina=1', token)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body.error.details)).toContain('limite');
  });

  it('los rechaza en los parámetros de ruta', async () => {
    const token = await ctx.accessTokenFor('ADMIN');
    const response = await ctx.get('/api/v1/users/1/extra', token).expect(404);
    // No existe la ruta: es un 404 de endpoint, no un 400 de campo.
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
    expect(response.body.error.details.type).toBe('route');
  });

  it('rechaza `businessId` en el body de cualquier endpoint', async () => {
    const token = await ctx.accessTokenFor('ADMIN');
    const response = await ctx
      .post('/api/v1/users', {
        email: ctx.uniqueEmail('negocio'),
        fullName: 'Empleado',
        roles: ['STAFF'],
        businessId: 3,
      }, token)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((response.body.error.details as { path: string }[])[0]?.path).toBe('businessId');
  });
});

describe('Formato y rango de los campos', () => {
  it('rechaza un email inválido con el campo en `details`', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: 'no-es-un-correo',
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Correo',
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((response.body.error.details as { path: string }[])[0]?.path).toBe('email');
  });

  it('rechaza un email de más de 254 caracteres (DESIGN.md 11.6)', async () => {
    const largo = `${'a'.repeat(250)}@example.test`;
    const response = await ctx
      .post('/api/v1/auth/register', { email: largo, password: VALID_TEST_PASSWORD, fullName: 'Cliente Largo' })
      .expect(400);
    expect(JSON.stringify(response.body.error.details)).toContain('email');
  });

  it('rechaza un teléfono que no es E.164', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('telefono'),
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Teléfono',
        phone: '3001234567',
      })
      .expect(400);
    expect((response.body.error.details as { path: string }[])[0]?.path).toBe('phone');
  });

  it('rechaza una foto_url que no es http(s)', async () => {
    const email = ctx.uniqueEmail('foto');
    const response = await ctx
      .post('/api/v1/auth/register', {
        email,
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Foto',
        photoUrl: 'javascript:alert(1)',
      })
      .expect(400);
    expect((response.body.error.details as { path: string }[])[0]?.path).toBe('photoUrl');
  });

  it('rechaza un cuerpo malformado sin filtrar detalles internos', async () => {
    // `text/plain` no es un tipo que el parser de cuerpos acepte: el body llega
    // vacío y el esquema lo rechaza con 400, no con 500.
    const response = await ctx.agent
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send('email=admin@lattecoffe.co&password=LatteCofee#2026');
    expect([400, 401]).toContain(response.status);
    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('SQLITE');
    expect(JSON.stringify(response.body)).not.toContain('at Object.');
  });

  it('rechaza JSON sintácticamente inválido con 400', async () => {
    const response = await ctx.agent
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza un refresh token con longitud imposible', async () => {
    const response = await ctx
      .post('/api/v1/auth/refresh', { refreshToken: 'corto' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('exige un id numérico positivo en la ruta', async () => {
    const token = await ctx.accessTokenFor('ADMIN');
    const response = await ctx.get('/api/v1/users/abc', token).expect(400);
    expect((response.body.error.details as { path: string }[])[0]?.path).toBe('id');
  });

  it('devuelve 404 con `requestId` para un endpoint inexistente', async () => {
    const response = await ctx.get('/api/v1/no-existe').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
    expect(typeof response.body.requestId).toBe('string');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('respeta el `X-Request-Id` entrante (API.md 1)', async () => {
    const requestId = 'test-correlacion-0001';
    const response = await ctx.agent
      .get('/api/v1/health')
      .set('X-Request-Id', requestId)
      .expect(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body.meta.requestId).toBe(requestId);
  });
});

describe('Límite de tasa de recuperación de contraseña (DESIGN.md 11.3)', () => {
  it('forgot-password: 3 por hora y luego 429 con Retry-After', async () => {
    const statuses: number[] = [];
    for (let intento = 0; intento < 4; intento += 1) {
      const response = await ctx.post('/api/v1/auth/forgot-password', { email: inexistente });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.body.error.code).toBe('RATE_LIMIT_ERROR');
        expect(response.body.error.details.limit).toBe(3);
        expect(response.body.error.details.windowMs).toBeGreaterThan(0);
        expect(response.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
        // Cabeceras obligatorias del contrato (API.md 4).
        expect(response.headers['retry-after']).toBeDefined();
        expect(response.headers['ratelimit-limit']).toBe('3');
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('el límite es compartido con reset-password: gastar en una agota la otra', async () => {
    // La cuota de `forgot-password` ya se consumió en el test anterior.
    const response = await ctx
      .post('/api/v1/auth/reset-password', {
        token: 'a'.repeat(48),
        password: 'NuevaClave#2026',
        confirmPassword: 'NuevaClave#2026',
      })
      .expect(429);
    expect(response.body.error.code).toBe('RATE_LIMIT_ERROR');
  });

  it('el resto de la API conserva su propio límite, más alto', async () => {
    // El límite global (1 000 000/min en tests) no ha sido tocado por el de
    // autenticación: `GET /meta/roles` sigue respondiendo 200.
    const response = await ctx.get('/api/v1/meta/roles').expect(200);
    expect(response.body.data.roles.length).toBe(6);
  });
});

describe('Envoltorio de respuesta (API.md 3)', () => {
  it('toda respuesta lleva `requestId` y las claves de la forma correcta', async () => {
    const ok = await ctx.get('/api/v1/health').expect(200);
    expect(ok.body.success).toBe(true);
    expect(typeof ok.body.data).toBe('object');
    expect(typeof ok.body.meta.requestId).toBe('string');

    const ko = await ctx.get('/api/v1/auth/me').expect(401);
    expect(ko.body.success).toBe(false);
    expect(typeof ko.body.error.code).toBe('string');
    expect(typeof ko.body.error.message).toBe('string');
    // `requestId` va FUERA de `error`, a nivel raíz.
    expect(ko.body.error.requestId).toBeUndefined();
    expect(typeof ko.body.requestId).toBe('string');
  });

  it('nunca devuelve una traza ni detalles técnicos', async () => {
    const responses = [
      await ctx.get('/api/v1/auth/me').expect(401),
      await ctx.get('/api/v1/auth/me', 'basura').expect(401),
      await ctx.get('/api/v1/meta/roles/xxx').expect(404),
      await ctx.post('/api/v1/auth/login', { email: 'x', password: 'y' }).expect(400),
    ];
    for (const response of responses) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('at ');
      expect(body).not.toContain('.ts:');
      expect(body).not.toContain('SQLITE');
      expect(body).not.toContain('/home/');
      expect(response.body.error.message).not.toMatch(/[A-Z_]{5,}\./);
    }
  });

  it('registra la petición con el user agent que ve el cliente', async () => {
    const email = ctx.uniqueEmail('useragent');
    await ctx
      .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente UA' })
      .expect(201);
    await ctx
      .post('/api/v1/auth/login', { email, password: VALID_TEST_PASSWORD })
      .expect(200);

    const row = ctx.db
      .prepare('SELECT user_agent, ip_address, request_id FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1')
      .get('LOGIN') as { user_agent: string | null; ip_address: string | null; request_id: string | null };
    expect(row.user_agent).toContain('LatteCoffeTests');
    expect(row.request_id).toBeTruthy();
    expect(TEST_USER_AGENT.length).toBeGreaterThan(0);
  });
});
