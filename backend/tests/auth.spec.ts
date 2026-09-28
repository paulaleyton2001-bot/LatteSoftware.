/**
 * Pruebas de `POST /api/v1/auth/*` contra la app completa.
 *
 * Cada prueba cita la regla que verifica (`BR-SEC-00x`, `API.md 7.1`).
 *
 * La suite usa el harness compartido (`helpers/harness.ts`): base SQLite en
 * memoria con migraciones y semilla aplicadas, y la MISMA app que corre en
 * producción. No hay stubs ni dobles: si un test pasa, la ruta real funciona.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { sha256Hex } from '../src/shared/utils/random.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx.close();
});

/** Cliente recién registrado, con sus tokens y su id. */
interface RegisteredCustomer {
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly userId: number;
  readonly sessionId: number;
}

/** Registra un cliente nuevo y devuelve sus credenciales y tokens. */
async function registerCustomer(prefix = 'cliente'): Promise<RegisteredCustomer> {
  const email = ctx.uniqueEmail(prefix);
  const response = await ctx
    .post('/api/v1/auth/register', {
      email,
      password: VALID_TEST_PASSWORD,
      fullName: 'Cliente de Prueba',
    })
    .expect(201);
  return {
    email,
    password: VALID_TEST_PASSWORD,
    accessToken: String(response.body.data.accessToken),
    refreshToken: String(response.body.data.refreshToken),
    userId: Number(response.body.data.user.id),
    sessionId: Number(response.body.data.sessionId),
  };
}

describe('POST /api/v1/auth/register', () => {
  it('crea el cliente, devuelve tokens y NO expone el hash de la contraseña', async () => {
    const email = ctx.uniqueEmail('registro');
    const response = await ctx
      .post('/api/v1/auth/register', {
        email,
        password: VALID_TEST_PASSWORD,
        fullName: 'Ana Cliente',
        phone: '+573001234567',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.expiresIn).toBe(900);
    expect(typeof response.body.data.accessToken).toBe('string');
    expect(typeof response.body.data.refreshToken).toBe('string');

    const user = response.body.data.user;
    expect(user.email).toBe(email);
    expect(user.roles).toEqual(['CUSTOMER']);
    expect(user.isStaff).toBe(false);
    expect(user.permissions).toContain('auth:profile:update');
    expect(user.permissions).not.toContain('users:read');

    // La garantía de seguridad, comprobada sobre el JSON serializado completo:
    // ninguna clave que suene a credencial puede aparecer en la respuesta.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('password_reset_token_hash');
  });

  it('normaliza el email a minúsculas (BR-SEC-010) y el CHECK de la tabla lo acepta', async () => {
    const email = ctx.uniqueEmail('Mayusculas');
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: email.toUpperCase(),
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Mayúsculas',
      })
      .expect(201);
    expect(response.body.data.user.email).toBe(email.toLowerCase());
  });

  it('rechaza un email duplicado con 409 CONFLICT_ERROR (API.md 7.1)', async () => {
    const customer = await registerCustomer('duplicado');
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: customer.email,
        password: VALID_TEST_PASSWORD,
        fullName: 'Otro Cliente',
      })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('EMAIL_TAKEN');
  });

  it('crea la fila de users y la de user_roles en la MISMA transacción', async () => {
    const email = ctx.uniqueEmail('atomico');
    await ctx
      .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Atómico' })
      .expect(201);

    const row = ctx.db
      .prepare(
        `SELECT u.id, u.is_staff, r.name AS role
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r       ON r.id = ur.role_id
          WHERE u.email = ?`,
      )
      .get(email) as { id: number; is_staff: 0 | 1; role: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.role).toBe('CUSTOMER');
    expect(row?.is_staff).toBe(0);
  });

  it('rechaza una contraseña débil con 400 y detalles accionables (BR-SEC-001)', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('debil'),
        password: 'corta',
        fullName: 'Cliente Débil',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const details = response.body.error.details as { path: string; message: string; code: string }[];
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((detail) => detail.path === 'password')).toBe(true);
    // El mensaje dice QUÉ falta, no devuelve la contraseña.
    expect(JSON.stringify(details)).toContain('8 caracteres');
    expect(JSON.stringify(response.body)).not.toContain('corta"');
  });

  it('rechaza una contraseña de una sola clase de caracteres', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('simple'),
        password: 'abcdefghijkl',
        fullName: 'Cliente Simple',
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body.error.details)).toContain('3 de estos 4');
  });

  it('rechaza una contraseña trivial de la lista negra', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('trivial'),
        password: 'Password#1',
        fullName: 'Cliente Trivial',
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza un campo desconocido en el body con 400 (API.md 1)', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('campos'),
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Campos',
        isAdmin: true,
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const details = response.body.error.details as { path: string; code: string }[];
    expect(details.some((detail) => detail.path === 'isAdmin' && detail.code === 'UNKNOWN_FIELD')).toBe(true);
  });

  it('rechaza `businessId`: la identidad del negocio sale del token (API.md 2)', async () => {
    const response = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('negocio'),
        password: VALID_TEST_PASSWORD,
        fullName: 'Cliente Negocio',
        businessId: 7,
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('autentica con credenciales correctas y devuelve access + refresh', async () => {
    const customer = await registerCustomer('login');
    const response = await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: customer.password })
      .expect(200);

    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.expiresIn).toBe(900);
    expect(response.body.data.user.email).toBe(customer.email);
    expect(typeof response.body.data.sessionId).toBe('number');
    // El perfil autenticado lleva roles y permisos resueltos (BR-RBAC-005).
    expect(response.body.data.user.permissions).toContain('auth:profile:read');
  });

  it('acepta el email en mayúsculas gracias a la normalización (BR-SEC-010)', async () => {
    const customer = await registerCustomer('case');
    await ctx
      .post('/api/v1/auth/login', { email: customer.email.toUpperCase(), password: customer.password })
      .expect(200);
  });

  it('rechaza una contraseña incorrecta con 401 INVALID_CREDENTIALS', async () => {
    const customer = await registerCustomer('mala');
    const response = await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: 'OtraClave#2026' })
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(response.body.error.details.code).toBe('INVALID_CREDENTIALS');
  });

  it('NO revela si el email existe: mismo mensaje y mismo código (DESIGN.md 11.1)', async () => {
    const customer = await registerCustomer('enumeracion');
    const wrongPassword = await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: 'OtraClave#2026' })
      .expect(401);
    const unknownEmail = await ctx
      .post('/api/v1/auth/login', { email: ctx.uniqueEmail('fantasma'), password: 'OtraClave#2026' })
      .expect(401);

    // Mensaje idéntico: no hay forma de distinguir los dos casos por el cuerpo.
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.details.code).toBe(wrongPassword.body.error.details.code);
  });

  it('registra el intento fallido en audit_logs (BR-SEC-007)', async () => {
    const email = ctx.uniqueEmail('auditoria-fallo');
    await ctx.post('/api/v1/auth/login', { email, password: 'OtraClave#2026' }).expect(401);

    const row = ctx.db
      .prepare(
        `SELECT action, user_email, request_id, ip_address FROM audit_logs
          WHERE action = 'LOGIN_FAILED' AND user_email = ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(email) as { action: string; user_email: string; request_id: string; ip_address: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.request_id).toBeTruthy();
    // Ni la contraseña ni su hash en la auditoría.
    const after = ctx.db
      .prepare('SELECT after_data FROM audit_logs WHERE id = (SELECT MAX(id) FROM audit_logs)')
      .get() as { after_data: string };
    expect(after.after_data).not.toContain('OtraClave#2026');
  });

  it('impide el login de un usuario bloqueado con 403 (BR-SEC-004)', async () => {
    const email = ctx.uniqueEmail('bloqueado');
    ctx.createUser({ email, fullName: 'Cliente Bloqueado', roles: ['CUSTOMER'], status: 'BLOCKED' });

    const response = await ctx
      .post('/api/v1/auth/login', { email, password: VALID_TEST_PASSWORD })
      .expect(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
  });
});

describe('POST /api/v1/auth/refresh (rotación)', () => {
  it('rota el refresh token: el viejo queda revocado y el nuevo sirve', async () => {
    const customer = await registerCustomer('rotacion');
    const first = await ctx
      .post('/api/v1/auth/refresh', { refreshToken: customer.refreshToken })
      .expect(200);

    expect(first.body.data.refreshToken).not.toBe(customer.refreshToken);
    expect(typeof first.body.data.accessToken).toBe('string');

    // El token viejo está revocado y apunta al nuevo (BR-RBAC-007 / DESIGN.md 11.2).
    const oldRow = ctx.db
      .prepare('SELECT revoked_at, replaced_by_id FROM refresh_tokens WHERE token_hash = ?')
      .get(sha256Hex(customer.refreshToken)) as
      | { revoked_at: string | null; replaced_by_id: number | null }
      | undefined;
    expect(oldRow?.revoked_at).not.toBeNull();
    expect(oldRow?.replaced_by_id).toBe(first.body.data.sessionId);

    // Y el nuevo sirve para seguir refreshing.
    await ctx.post('/api/v1/auth/refresh', { refreshToken: first.body.data.refreshToken }).expect(200);
  });

  it('SOLO guarda el SHA-256 del refresh token, nunca el valor en claro (DESIGN.md 4.1)', async () => {
    const customer = await registerCustomer('hasheado');
    const rows = ctx.db
      .prepare('SELECT token_hash FROM refresh_tokens')
      .all() as { token_hash: string }[];

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).not.toBe(customer.refreshToken);
    }
    // Y el hash guardado ES el del token que devolvió la API.
    expect(rows.some((row) => row.token_hash === sha256Hex(customer.refreshToken))).toBe(true);
  });

  it('detecta el REUSO de un token ya revocado, revoca la familia y devuelve 401', async () => {
    const customer = await registerCustomer('reuso');
    const rotated = await ctx
      .post('/api/v1/auth/refresh', { refreshToken: customer.refreshToken })
      .expect(200);

    const reuso = await ctx
      .post('/api/v1/auth/refresh', { refreshToken: customer.refreshToken })
      .expect(401);
    expect(reuso.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(reuso.body.error.details.code).toBe('TOKEN_REUSE');

    // Se revocan TODAS las sesiones del usuario, incluida la legítima.
    const vivos = ctx.db
      .prepare('SELECT COUNT(*) AS total FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .get(customer.userId) as { total: number };
    expect(vivos.total).toBe(0);

    // Y queda el rastro del robo.
    const audit = ctx.db
      .prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'REFRESH_TOKEN_REUSE'")
      .get() as { total: number };
    expect(audit.total).toBeGreaterThan(0);

    // El token nuevo tampoco sirve: la familia entera está muerta.
    await ctx
      .post('/api/v1/auth/refresh', { refreshToken: rotated.body.data.refreshToken })
      .expect(401);
  });

  it('rechaza un refresh token desconocido con 401', async () => {
    const response = await ctx
      .post('/api/v1/auth/refresh', { refreshToken: 'a'.repeat(48) })
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('POST /api/v1/auth/logout y /logout-all', () => {
  it('logout revoca la sesión actual y es idempotente (API.md 7.1)', async () => {
    const customer = await registerCustomer('logout');
    const first = await ctx.post('/api/v1/auth/logout', undefined, customer.accessToken).expect(200);
    expect(first.body.data).toBeNull();
    expect(first.body.meta.revokedSessions).toBe(1);

    // Repetir el logout no es un error.
    const second = await ctx.post('/api/v1/auth/logout', undefined, customer.accessToken).expect(200);
    expect(second.body.meta.revokedSessions).toBe(0);

    // Y el refresh token de esa sesión ya no vale.
    await ctx.post('/api/v1/auth/refresh', { refreshToken: customer.refreshToken }).expect(401);
  });

  it('logout-all revoca todas las sesiones del usuario (BR-SEC-003)', async () => {
    const customer = await registerCustomer('logout-all');
    const second = await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: customer.password })
      .expect(200);
    const otherRefresh = String(second.body.data.refreshToken);

    const response = await ctx.post('/api/v1/auth/logout-all', undefined, customer.accessToken).expect(200);
    expect(response.body.meta.revokedSessions).toBeGreaterThanOrEqual(2);

    await ctx.post('/api/v1/auth/refresh', { refreshToken: customer.refreshToken }).expect(401);
    await ctx.post('/api/v1/auth/refresh', { refreshToken: otherRefresh }).expect(401);
  });

  it('logout-all con contraseña incorrecta devuelve 403', async () => {
    const customer = await registerCustomer('logout-all-mal');
    const response = await ctx
      .post('/api/v1/auth/logout-all', { currentPassword: 'NoEsLaMia#2026' }, customer.accessToken)
      .expect(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('exige credencial: sin token responde 401 MISSING_TOKEN (BR-SEC-005)', async () => {
    const response = await ctx.post('/api/v1/auth/logout').expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(response.body.error.details.code).toBe('MISSING_TOKEN');
  });
});

describe('Recuperación de contraseña', () => {
  it('forgot-password responde 200 con el mismo mensaje exista o no el email', async () => {
    const customer = await registerCustomer('olvido');

    const conCuenta = await ctx
      .post('/api/v1/auth/forgot-password', { email: customer.email })
      .expect(200);
    const sinCuenta = await ctx
      .post('/api/v1/auth/forgot-password', { email: ctx.uniqueEmail('nadie') })
      .expect(200);

    expect(conCuenta.body.error).toBeUndefined();
    expect(sinCuenta.body.error).toBeUndefined();
    expect(conCuenta.body.meta.message).toBe(sinCuenta.body.meta.message);
    expect(conCuenta.body.meta.message).toContain('Si la cuenta existe');
  });

  it('reset-password cambia la contraseña, revoca las sesiones y anula el token', async () => {
    const customer = await registerCustomer('reseteo');
    // forgot-password deja el hash SHA-256 del token en `users` (API.md 7.1).
    await ctx.post('/api/v1/auth/forgot-password', { email: customer.email }).expect(200);
    const pending = ctx.db
      .prepare('SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE email = ?')
      .get(customer.email) as { password_reset_token_hash: string; password_reset_expires_at: string };
    expect(pending.password_reset_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(pending.password_reset_expires_at)).toBeGreaterThan(Date.now());

    // El token viaja por correo en producción; en el test lo emite el harness
    // con el MISMO `TokenService` que usa la API, de modo que la validación de
    // hash y expiración del endpoint es la real.
    const token = ctx.issueResetTokenFor(customer.email);
    expect(sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);

    const nuevaPassword = 'NuevaClave#2026';
    const response = await ctx
      .post('/api/v1/auth/reset-password', {
        token,
        password: nuevaPassword,
        confirmPassword: nuevaPassword,
      })
      .expect(200);
    expect(response.body.data).toBeNull();
    expect(response.body.meta.sessionsRevoked).toBeGreaterThanOrEqual(1);

    // La contraseña nueva sirve y la vieja no.
    await ctx.post('/api/v1/auth/login', { email: customer.email, password: nuevaPassword }).expect(200);
    await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: customer.password })
      .expect(401);

    // El token es de un solo uso: el segundo intento falla con el código estable.
    // API.md 7.1 pide `details.code = 'INVALID_RESET_TOKEN'` y API.md 3.2 pide que
    // un 400 de validación lleve `details` como array de rutas; se comprueba el
    // contenido serializado para no atar el test a una de las dos lecturas.
    const reuse = await ctx
      .post('/api/v1/auth/reset-password', {
        token,
        password: 'OtraClave#2026',
        confirmPassword: 'OtraClave#2026',
      })
      .expect(400);
    expect(reuse.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(reuse.body.error.details)).toContain('INVALID_RESET_TOKEN');
  });

  it('reset-password rechaza una contraseña débil con 400', async () => {
    const customer = await registerCustomer('reseteo-debil');
    const token = ctx.issueResetTokenFor(customer.email);

    const response = await ctx
      .post('/api/v1/auth/reset-password', { token, password: '12345678', confirmPassword: '12345678' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reset-password exige que las contraseñas coincidan', async () => {
    const customer = await registerCustomer('reseteo-coincide');
    await ctx.post('/api/v1/auth/forgot-password', { email: customer.email }).expect(200);
    const token = ctx.issueResetTokenFor(customer.email);

    const response = await ctx
      .post('/api/v1/auth/reset-password', {
        token,
        password: 'NuevaClave#2026',
        confirmPassword: 'OtraClave#2026',
      })
      .expect(400);
    expect(JSON.stringify(response.body.error.details)).toContain('PASSWORD_MISMATCH');
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('cambia la contraseña y revoca el resto de sesiones (BR-SEC-003)', async () => {
    const customer = await registerCustomer('cambio');
    const otra = await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: customer.password })
      .expect(200);
    const otroRefresh = String(otra.body.data.refreshToken);

    const nueva = 'Cambiada#2026';
    const response = await ctx
      .post('/api/v1/auth/change-password', {
        currentPassword: customer.password,
        newPassword: nueva,
        confirmPassword: nueva,
      }, customer.accessToken)
      .expect(200);

    // La sesión actual se rota y sigue viva con el par nuevo.
    expect(typeof response.body.data.accessToken).toBe('string');
    const nuevoRefresh = String(response.body.data.refreshToken);
    expect(nuevoRefresh).not.toBe(customer.refreshToken);
    await ctx.post('/api/v1/auth/refresh', { refreshToken: nuevoRefresh }).expect(200);

    // La otra sesión muere.
    await ctx.post('/api/v1/auth/refresh', { refreshToken: otroRefresh }).expect(401);

    // Y la contraseña nueva vale mientras la vieja no.
    await ctx.post('/api/v1/auth/login', { email: customer.email, password: nueva }).expect(200);
    await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: customer.password })
      .expect(401);
  });

  it('con keepCurrentSession=false cierra todas las sesiones', async () => {
    const customer = await registerCustomer('cambio-total');
    const nueva = 'Cambiada#2026';
    const response = await ctx
      .post('/api/v1/auth/change-password', {
        currentPassword: customer.password,
        newPassword: nueva,
        confirmPassword: nueva,
        keepCurrentSession: false,
      }, customer.accessToken)
      .expect(200);

    expect(response.body.data).toBeNull();
    expect(response.body.meta.sessionsRevoked).toBeGreaterThanOrEqual(1);
    await ctx.post('/api/v1/auth/refresh', { refreshToken: customer.refreshToken }).expect(401);
  });

  it('rechaza la contraseña actual incorrecta con 401', async () => {
    const customer = await registerCustomer('cambio-mal');
    const response = await ctx
      .post('/api/v1/auth/change-password', {
        currentPassword: 'NoEsLaMia#2026',
        newPassword: 'NuevaClave#2026',
        confirmPassword: 'NuevaClave#2026',
      }, customer.accessToken)
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rechaza repetir la misma contraseña con 422', async () => {
    const customer = await registerCustomer('cambio-igual');
    const response = await ctx
      .post('/api/v1/auth/change-password', {
        currentPassword: customer.password,
        newPassword: customer.password,
        confirmPassword: customer.password,
      }, customer.accessToken)
      .expect(422);
    expect(response.body.error.details.code).toBe('PASSWORD_SAME_AS_CURRENT');
  });
});

describe('Perfil y sesiones', () => {
  it('GET /auth/me devuelve roles y permisos resueltos, sin datos sensibles', async () => {
    const customer = await registerCustomer('perfil');
    const response = await ctx.get('/api/v1/auth/me', customer.accessToken).expect(200);

    expect(response.body.data.email).toBe(customer.email);
    expect(response.body.data.roles).toEqual(['CUSTOMER']);
    expect(Array.isArray(response.body.data.permissions)).toBe(true);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain('refreshToken');
  });

  it('GET /auth/me sin token devuelve 401 y con token basura también', async () => {
    await ctx.get('/api/v1/auth/me').expect(401);
    const response = await ctx.get('/api/v1/auth/me', 'no.es.un.jwt').expect(401);
    expect(response.body.error.details.code).toBe('INVALID_TOKEN');
  });

  it('PATCH /auth/me actualiza nombre, teléfono y foto; el email NO se cambia', async () => {
    const customer = await registerCustomer('patch-perfil');
    const response = await ctx
      .patch(
        '/api/v1/auth/me',
        { fullName: 'Nombre Nuevo', phone: '+573009999999', photoUrl: 'https://cdn.example.test/a.png' },
        customer.accessToken,
      )
      .expect(200);

    expect(response.body.data.fullName).toBe('Nombre Nuevo');
    expect(response.body.data.phone).toBe('+573009999999');
    expect(response.body.data.photoUrl).toBe('https://cdn.example.test/a.png');

    // Intentar cambiar el email por esta vía es un 400 con el campo señalado.
    const emailAttempt = await ctx
      .patch('/api/v1/auth/me', { email: ctx.uniqueEmail('nuevo') }, customer.accessToken)
      .expect(400);
    expect(JSON.stringify(emailAttempt.body.error.details)).toContain('email');

    // Y tampoco el estado ni los roles.
    await ctx.patch('/api/v1/auth/me', { status: 'ADMIN' }, customer.accessToken).expect(400);
    await ctx.patch('/api/v1/auth/me', { roles: ['ADMIN'] }, customer.accessToken).expect(400);
  });

  it('GET /auth/sessions lista las sesiones activas y marca la actual', async () => {
    const customer = await registerCustomer('sesiones');
    const response = await ctx.get('/api/v1/auth/sessions', customer.accessToken).expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    const current = response.body.data.find(
      (session: { isCurrent: boolean }) => session.isCurrent === true,
    );
    expect(current).toBeDefined();
    // `device_info` se guarda a partir del User-Agent de la petición.
    expect(current.deviceInfo).toContain('LatteCoffeTests');
    expect(current.ipAddress).toBeTruthy();
    expect(current.createdAt).toBeTruthy();
    expect(current.expiresAt).toBeTruthy();
    // Nunca el hash del token.
    expect(JSON.stringify(response.body)).not.toContain('token_hash');
    expect(JSON.stringify(response.body)).not.toContain('tokenHash');
  });

  it('DELETE /auth/sessions/:id revoca otra sesión y no la actual', async () => {
    const customer = await registerCustomer('revocar-sesion');
    const otra = await ctx
      .post('/api/v1/auth/login', { email: customer.email, password: customer.password })
      .expect(200);
    const otraSessionId = Number(otra.body.data.sessionId);

    const response = await ctx
      .delete(`/api/v1/auth/sessions/${otraSessionId}`, customer.accessToken)
      .expect(200);
    expect(response.body.data).toBeNull();

    // Idempotente: la segunda vez avisa con `ALREADY_REVOKED`.
    const repeat = await ctx
      .delete(`/api/v1/auth/sessions/${otraSessionId}`, customer.accessToken)
      .expect(200);
    expect(repeat.body.meta.warnings).toContain('ALREADY_REVOKED');

    // La sesión actual no se puede revocar por aquí: para eso está /logout.
    await ctx.delete(`/api/v1/auth/sessions/${customer.sessionId}`, customer.accessToken).expect(422);

    // Una sesión de otro usuario no existe: 404, no 403.
    await ctx.delete(`/api/v1/auth/sessions/${otraSessionId + 9999}`, customer.accessToken).expect(404);
  });

  it('GET /auth/sessions rechaza ordenar por una columna fuera de la allowlist', async () => {
    const customer = await registerCustomer('orden-sesiones');
    const response = await ctx
      .get('/api/v1/auth/sessions?sort=token_hash', customer.accessToken)
      .expect(400);
    expect(response.body.error.details.some((detail: { code: string }) => detail.code === 'INVALID_SORT_FIELD')).toBe(true);
  });
});

describe('Token de reseteo emitido por forgot-password', () => {
  it('queda guardado SOLO como hash y se anula al usarlo', async () => {
    const email = ctx.uniqueEmail('hash-reset');
    await ctx
      .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Reset' })
      .expect(201);

    await ctx.post('/api/v1/auth/forgot-password', { email }).expect(200);
    const pending = ctx.db
      .prepare('SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE email = ?')
      .get(email) as { password_reset_token_hash: string; password_reset_expires_at: string };

    // Es un sha256 hexadecimal, no el token: 64 caracteres, sólo [0-9a-f].
    expect(pending.password_reset_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pending.password_reset_expires_at).toBeTruthy();

    // Al resetear, el token se anula (uso único).
    const token = ctx.issueResetTokenFor(email);
    await ctx
      .post('/api/v1/auth/reset-password', {
        token,
        password: 'NuevaClave#2026',
        confirmPassword: 'NuevaClave#2026',
      })
      .expect(200);
    const after = ctx.db
      .prepare('SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE email = ?')
      .get(email) as { password_reset_token_hash: string | null; password_reset_expires_at: string | null };
    expect(after.password_reset_token_hash).toBeNull();
    expect(after.password_reset_expires_at).toBeNull();
  });
});
