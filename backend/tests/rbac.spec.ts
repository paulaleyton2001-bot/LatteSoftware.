/**
 * Pruebas de RBAC sobre la API real: `GET/POST/PATCH/DELETE /api/v1/users` y
 * los permisos de los módulos `users` y `customers`.
 *
 * Lo que se verifica aquí NO es una matriz escrita en el test: es que la
 * comprobación se hace contra `role_permissions` de la base de datos, sembrada
 * desde `docs/DESIGN.md` 9.3. Si alguien cambiara una fila de la matriz, estos
 * tests lo detectarían.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';

let ctx: TestContext;
let adminToken: string;
let ownerToken: string;
let cashierToken: string;
let managerToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
  adminToken = await ctx.accessTokenFor('ADMIN');
  ownerToken = await ctx.accessTokenFor('OWNER');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  managerToken = await ctx.accessTokenFor('MANAGER');
});

afterAll(() => {
  ctx.close();
});

/** Crea un cliente y devuelve `{ id, email, token }`. */
async function createCustomer(prefix: string): Promise<{ id: number; email: string; token: string }> {
  const email = ctx.uniqueEmail(prefix);
  const response = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente RBAC' })
    .expect(201);
  return {
    id: Number(response.body.data.user.id),
    email,
    token: String(response.body.data.accessToken),
  };
}

/** Crea un usuario con un rol dado y devuelve su id. */
function createStaff(prefix: string, role: 'STAFF' | 'CASHIER' | 'MANAGER' | 'ADMIN'): number {
  const email = ctx.uniqueEmail(prefix);
  return ctx.createUser({ email, fullName: `Usuario ${role}`, roles: [role] });
}

describe('Un CUSTOMER no administra usuarios (BR-SEC-012)', () => {
  it('recibe 403 con `details.required` en cada endpoint de /users', async () => {
    const customer = await createCustomer('rbac-cliente');

    const endpoints: { method: 'get' | 'post' | 'patch' | 'delete'; path: string; required: string }[] = [
      { method: 'get', path: '/api/v1/users', required: 'users:read' },
      { method: 'post', path: '/api/v1/users', required: 'users:create' },
      { method: 'get', path: '/api/v1/users/1', required: 'users:read' },
      { method: 'patch', path: '/api/v1/users/1', required: 'users:update' },
      { method: 'delete', path: '/api/v1/users/1', required: 'users:delete' },
      { method: 'post', path: '/api/v1/users/1/roles', required: 'users:roles:assign' },
      { method: 'delete', path: '/api/v1/users/1/roles/6', required: 'users:roles:assign' },
      { method: 'patch', path: '/api/v1/users/1/status', required: 'users:status:update' },
      { method: 'post', path: '/api/v1/users/1/reset-password', required: 'users:password:reset' },
    ];

    for (const endpoint of endpoints) {
      const call =
        endpoint.method === 'get' || endpoint.method === 'delete'
          ? ctx[endpoint.method](endpoint.path, customer.token)
          : ctx[endpoint.method](endpoint.path, { status: 'INACTIVE', roleId: 6 }, customer.token);

      const response = await call.expect(403);
      expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
      expect(response.body.error.details.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.error.details.required).toBe(endpoint.required);
    }
  });

  it('sin token responde 401, no 403 (BR-SEC-005)', async () => {
    const response = await ctx
      .post('/api/v1/users', { email: 'x@y.test', fullName: 'X', roles: ['STAFF'] })
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(response.body.error.details.code).toBe('MISSING_TOKEN');
  });

  it('el cliente sí puede listar clientes y ver su propia ficha, pero no el directorio', async () => {
    const customer = await createCustomer('rbac-clientes');

    // Su propia ficha: 200.
    const me = await ctx.get('/api/v1/customers/me', customer.token).expect(200);
    expect(me.body.data.id).toBe(customer.id);
    expect(me.body.data.stats.totalOrders).toBe(0);

    // El directorio completo es una herramienta de sala: 403.
    const listado = await ctx.get('/api/v1/customers', customer.token).expect(403);
    expect(listado.body.error.code).toBe('AUTHORIZATION_ERROR');

    // Su propio registro por id también: 200.
    await ctx.get(`/api/v1/customers/${customer.id}`, customer.token).expect(200);
  });

  it('un cliente NO ve la ficha de otro cliente: 404, no 403 (API.md 2)', async () => {
    const uno = await createCustomer('rbac-otro-1');
    const otro = await createCustomer('rbac-otro-2');
    const response = await ctx.get(`/api/v1/customers/${otro.id}`, uno.token).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
  });
});

describe('Permisos por rol', () => {
  it('el ADMIN puede listar, ver, crear y editar usuarios', async () => {
    const listado = await ctx.get('/api/v1/users?pageSize=5', adminToken).expect(200);
    expect(Array.isArray(listado.body.data)).toBe(true);
    expect(listado.body.meta.total).toBeGreaterThan(0);
    expect(listado.body.meta.page).toBe(1);
    // La respuesta nunca lleva el hash.
    expect(JSON.stringify(listado.body)).not.toContain('password_hash');

    const creado = await ctx
      .post(
        '/api/v1/users',
        {
          email: ctx.uniqueEmail('alta-admin'),
          fullName: 'Empleado Nuevo',
          roles: ['CASHIER'],
          password: VALID_TEST_PASSWORD,
        },
        adminToken,
      )
      .expect(201);
    expect(creado.body.data.roles).toEqual(['CASHIER']);
    expect(creado.body.data.isStaff).toBe(true);

    const id = Number(creado.body.data.id);
    await ctx.get(`/api/v1/users/${id}`, adminToken).expect(200);
    await ctx.patch(`/api/v1/users/${id}`, { fullName: 'Empleado Renombrado' }, adminToken).expect(200);

    const detalle = await ctx.get(`/api/v1/users/${id}`, adminToken).expect(200);
    expect(detalle.body.data.fullName).toBe('Empleado Renombrado');
    expect(detalle.body.data.permissions).toContain('payments:create');
  });

  it('el CASHIER puede atender clientes pero NO tocar usuarios', async () => {
    // `customers:read` es C para el cajero en DESIGN.md 9.3.
    const clientes = await ctx.get('/api/v1/customers', cashierToken).expect(200);
    expect(Array.isArray(clientes.body.data)).toBe(true);

    // `users:read` es denegado para el cajero: 403.
    const usuarios = await ctx.get('/api/v1/users', cashierToken).expect(403);
    expect(usuarios.body.error.details.required).toBe('users:read');
  });

  it('el MANAGER lee usuarios pero no los crea (BR-RBAC-004)', async () => {
    const listado = await ctx.get('/api/v1/users?pageSize=1', managerToken).expect(200);
    expect(listado.body.meta.total).toBeGreaterThan(0);

    const intento = await ctx
      .post(
        '/api/v1/users',
        { email: ctx.uniqueEmail('manager'), fullName: 'No permitido', roles: ['STAFF'] },
        managerToken,
      )
      .expect(403);
    expect(intento.body.error.details.required).toBe('users:create');
  });

  it('un empleado STAFF no puede ni leer el directorio de clientes', async () => {
    const email = ctx.uniqueEmail('staff');
    ctx.createUser({ email, fullName: 'Empleado de Sala', roles: ['STAFF'] });
    const token = (await ctx.login(email, VALID_TEST_PASSWORD)).accessToken;

    await ctx.get('/api/v1/users', token).expect(403);
    const clientes = await ctx.get('/api/v1/customers', token).expect(403);
    expect(clientes.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('el listado filtra por rol, estado y texto, y pagina', async () => {
    const email = ctx.uniqueEmail('filtro');
    ctx.createUser({ email, fullName: 'Cajero Filtro', roles: ['CASHIER'] });

    const porRol = await ctx.get('/api/v1/users?role=CASHIER&pageSize=50', adminToken).expect(200);
    expect(porRol.body.data.length).toBeGreaterThan(0);
    expect(porRol.body.data.every((user: { roles: string[] }) => user.roles.includes('CASHIER'))).toBe(true);

    const porEstado = await ctx.get('/api/v1/users?status=BLOCKED', adminToken).expect(200);
    expect(porEstado.body.data.every((user: { status: string }) => user.status === 'BLOCKED')).toBe(true);

    const porTexto = await ctx.get(`/api/v1/users?q=${encodeURIComponent(email)}`, adminToken).expect(200);
    expect(porTexto.body.meta.total).toBe(1);
    expect(porTexto.body.data[0].email).toBe(email);

    const paginado = await ctx.get('/api/v1/users?page=1&pageSize=2', adminToken).expect(200);
    expect(paginado.body.data.length).toBe(2);
    expect(paginado.body.meta.pageSize).toBe(2);
  });

  it('rechaza un `sort` fuera de la allowlist y un `pageSize` excessive', async () => {
    const sort = await ctx.get('/api/v1/users?sort=password_hash', adminToken).expect(400);
    expect(
      (sort.body.error.details as { code: string }[]).some((d) => d.code === 'INVALID_SORT_FIELD'),
    ).toBe(true);

    const size = await ctx.get('/api/v1/users?pageSize=1000', adminToken).expect(400);
    expect(size.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Protección de cuentas de administración', () => {
  it('nadie se borra a sí mismo: 422 SELF_DELETE_FORBIDDEN (API.md 7.2)', async () => {
    const login = await ctx.login('admin@lattecoffe.co');
    const response = await ctx.delete(`/api/v1/users/${login.userId}`, adminToken).expect(422);
    expect(response.body.error.details.code).toBe('SELF_DELETE_FORBIDDEN');
  });

  it('un ADMIN no puede borrar a otro ADMIN: 403 ADMIN_ROLE_PROTECTED', async () => {
    const otroAdminId = createStaff('admin-objeto', 'ADMIN');
    const response = await ctx.delete(`/api/v1/users/${otroAdminId}`, adminToken).expect(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(response.body.error.details.code).toBe('ADMIN_ROLE_PROTECTED');
  });

  it('nadie se borra ni se desactiva a sí mismo, aunque sea el propietario', async () => {
    const ownerLogin = await ctx.login('owner@lattecoffe.co');
    const ownerId = ownerLogin.userId;
    const ownerRole = ctx.db.prepare("SELECT id FROM roles WHERE name = 'OWNER'").get() as { id: number };

    // El actor contra sí mismo: manda SELF_* antes que LAST_OWNER_*.
    const borrado = await ctx.delete(`/api/v1/users/${ownerId}`, ownerToken).expect(422);
    expect(borrado.body.error.details.code).toBe('SELF_DELETE_FORBIDDEN');

    const estado = await ctx
      .patch(`/api/v1/users/${ownerId}/status`, { status: 'INACTIVE' }, ownerToken)
      .expect(422);
    expect(estado.body.error.details.code).toBe('SELF_DEACTIVATION_FORBIDDEN');

    const rol = await ctx
      .delete(`/api/v1/users/${ownerId}/roles/${ownerRole.id}`, ownerToken)
      .expect(422);
    expect(rol.body.error.details.code).toBe('SELF_ROLE_REMOVAL_FORBIDDEN');

    // Sigue intacto.
    const ficha = await ctx.get(`/api/v1/users/${ownerId}`, ownerToken).expect(200);
    expect(ficha.body.data.status).toBe('ACTIVE');
    expect(ficha.body.data.roles).toContain('OWNER');
  });

  it('el último OWNER no puede ser borrado ni desactivado por otro (BR-RBAC-003)', async () => {
    // Un ADMIN sí tiene `users:delete` y `users:status:update`, así que es el
    // actor que puede intentar dejar el despliegue sin propietario.
    const adminEmail = ctx.uniqueEmail('admin-riesgo');
    ctx.createUser({ email: adminEmail, fullName: 'Admin de Prueba', roles: ['ADMIN'] });
    const adminSegunda = (await ctx.login(adminEmail, VALID_TEST_PASSWORD)).accessToken;

    const ownerLogin = await ctx.login('owner@lattecoffe.co');
    const ownerId = ownerLogin.userId;

    // Desactivarlo: 422 LAST_OWNER_PROTECTED.
    const estado = await ctx
      .patch(`/api/v1/users/${ownerId}/status`, { status: 'INACTIVE' }, adminSegunda)
      .expect(422);
    expect(estado.body.error.details.code).toBe('LAST_OWNER_PROTECTED');

    // Bloquearlo, igual.
    const bloqueo = await ctx
      .patch(
        `/api/v1/users/${ownerId}/status`,
        { status: 'BLOCKED', reason: 'Prueba' },
        adminSegunda,
      )
      .expect(422);
    expect(bloqueo.body.error.details.code).toBe('LAST_OWNER_PROTECTED');

    // Borrarlo, igual.
    const borrado = await ctx.delete(`/api/v1/users/${ownerId}`, adminSegunda).expect(422);
    expect(borrado.body.error.details.code).toBe('LAST_OWNER_PROTECTED');

    // El propietario conserva su rol y su estado.
    const ficha = await ctx.get(`/api/v1/users/${ownerId}`, ownerToken).expect(200);
    expect(ficha.body.data.status).toBe('ACTIVE');
    expect(ficha.body.data.roles).toContain('OWNER');

    // Y el mismo ADMIN no puede degradar al otro ADMIN (BR-RBAC-004): sólo un
    // OWNER concede o quita roles de administración superior.
    const otroAdmin = ctx.createUser({
      email: ctx.uniqueEmail('admin-2'),
      fullName: 'Segundo Admin',
      roles: ['ADMIN'],
    });
    const ownerRole = ctx.db.prepare("SELECT id FROM roles WHERE name = 'OWNER'").get() as { id: number };
    const escalada = await ctx
      .post(`/api/v1/users/${otroAdmin}/roles`, { roleId: ownerRole.id }, adminSegunda)
      .expect(403);
    expect(escalada.body.error.details.code).toBe('ELEVATED_ROLE_PROTECTED');
  });

  it('con dos OWNER, uno puede renunciar y el otro queda como dueño único', async () => {
    const ownerRole = ctx.db.prepare("SELECT id FROM roles WHERE name = 'OWNER'").get() as { id: number };
    const segundoEmail = ctx.uniqueEmail('owner-segundo');
    const segundoId = ctx.createUser({ email: segundoEmail, fullName: 'Segundo Propietario', roles: ['ADMIN'] });

    // ADMIN -> OWNER: sólo un OWNER puede concederlo (regla de roles elevados).
    const escalada = await ctx
      .post(`/api/v1/users/${segundoId}/roles`, { roleId: ownerRole.id }, adminToken)
      .expect(403);
    expect(escalada.body.error.details.code).toBe('ELEVATED_ROLE_PROTECTED');

    // Con el propietario de turno, sí.
    const ascenso = await ctx
      .post(`/api/v1/users/${segundoId}/roles`, { roleId: ownerRole.id }, ownerToken)
      .expect(200);
    expect(ascenso.body.data.assignedRoles).toContain('OWNER');

    const segundo = (await ctx.login(segundoEmail, VALID_TEST_PASSWORD)).accessToken;
    const ownerLogin = await ctx.login('owner@lattecoffe.co');

    // Con dos propietarios, el primero puede renunciar: no es el último.
    const renuncia = await ctx
      .delete(`/api/v1/users/${ownerLogin.userId}/roles/${ownerRole.id}`, segundo)
      .expect(200);
    expect(renuncia.body.data.roleId).toBe(ownerRole.id);

    // Y el que queda ya no puede quitarse su propio rol.
    const propio = await ctx
      .delete(`/api/v1/users/${segundoId}/roles/${ownerRole.id}`, segundo)
      .expect(422);
    expect(propio.body.error.details.code).toBe('SELF_ROLE_REMOVAL_FORBIDDEN');

    // Se restaura el estado inicial: el propietario sembrado recupera el rol.
    await ctx
      .post(`/api/v1/users/${ownerLogin.userId}/roles`, { roleId: ownerRole.id }, segundo)
      .expect(200);
    const restaurado = await ctx
      .delete(`/api/v1/users/${segundoId}/roles/${ownerRole.id}`, ownerToken)
      .expect(200);
    expect(restaurado.body.data.userId).toBe(segundoId);
  });

  it('asignar un rol ya asignado devuelve 409 ROLE_ALREADY_ASSIGNED', async () => {
    const targetId = createStaff('roles-duplicados', 'STAFF');
    const staffRole = ctx.db.prepare("SELECT id FROM roles WHERE name = 'STAFF'").get() as { id: number };
    const response = await ctx
      .post(`/api/v1/users/${targetId}/roles`, { roleId: staffRole.id }, adminToken)
      .expect(409);
    expect(response.body.error.details.code).toBe('ROLE_ALREADY_ASSIGNED');
  });

  it('cambiar roles revoca las sesiones del usuario (BR-RBAC-007)', async () => {
    const email = ctx.uniqueEmail('roles-sesiones');
    const targetId = ctx.createUser({ email, fullName: 'Empleado Sesiones', roles: ['STAFF'] });
    const login = await ctx.login(email, VALID_TEST_PASSWORD);

    const cashierRole = ctx.db.prepare("SELECT id FROM roles WHERE name = 'CASHIER'").get() as { id: number };
    await ctx.post(`/api/v1/users/${targetId}/roles`, { roleId: cashierRole.id }, adminToken).expect(200);

    // Su refresh token ya no sirve: los permisos cambian en el siguiente refresh.
    const response = await ctx
      .post('/api/v1/auth/refresh', { refreshToken: login.refreshToken })
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('Ciclo de vida de un usuario', () => {
  it('alta sin contraseña: genera una desconocida y devuelve token de un solo uso', async () => {
    const email = ctx.uniqueEmail('sin-password');
    const response = await ctx
      .post('/api/v1/users', { email, fullName: 'Empleado Sin Password', roles: ['STAFF'] }, adminToken)
      .expect(201);

    // Se devuelve una contraseña temporal (API.md 7.2) y la cuenta existe.
    expect(typeof response.body.meta.temporaryPassword).toBe('string');
    expect(JSON.stringify(response.body.data)).not.toContain('password_hash');

    // Y se puede autenticar con ella y cambiar a una definitiva.
    const login = await ctx
      .post('/api/v1/auth/login', { email, password: response.body.meta.temporaryPassword })
      .expect(200);
    const token = String(login.body.data.accessToken);
    const nueva = 'Propia#2026';
    await ctx
      .post(
        '/api/v1/auth/change-password',
        { currentPassword: response.body.meta.temporaryPassword, newPassword: nueva, confirmPassword: nueva },
        token,
      )
      .expect(200);
    await ctx.post('/api/v1/auth/login', { email, password: nueva }).expect(200);
  });

  it('bloquear a un usuario revoca sus sesiones y le impide el login (BR-SEC-004)', async () => {
    const email = ctx.uniqueEmail('bloqueo');
    ctx.createUser({ email, fullName: 'Empleado Bloqueable', roles: ['CASHIER'] });
    const login = await ctx.login(email, VALID_TEST_PASSWORD);

    const bloqueado = await ctx
      .patch(
        `/api/v1/users/${login.userId}/status`,
        { status: 'BLOCKED', reason: 'Prueba automatizada' },
        adminToken,
      )
      .expect(200);
    expect(bloqueado.body.data.status).toBe('BLOCKED');

    // Su refresh token muere.
    await ctx.post('/api/v1/auth/refresh', { refreshToken: login.refreshToken }).expect(401);
    // Y no puede volver a entrar. Se usa la contraseña CORRECTA a propósito: con
    // una incorrecta la respuesta sería 401 genérica (anti-enumeración), que no
    // distinguiría "contraseña mala" de "cuenta bloqueada".
    const reintento = await ctx
      .post('/api/v1/auth/login', { email, password: VALID_TEST_PASSWORD })
      .expect(403);
    expect(reintento.body.error.details.code).toBe('BLOCKED');
  });

  it('bloquear sin motivo es un 400', async () => {
    const email = ctx.uniqueEmail('bloqueo-sin-motivo');
    const id = ctx.createUser({ email, fullName: 'Empleado Motivo', roles: ['STAFF'] });
    const response = await ctx
      .patch(`/api/v1/users/${id}/status`, { status: 'BLOCKED' }, adminToken)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('el reseteo administrativo NUNCA devuelve una contraseña', async () => {
    const email = ctx.uniqueEmail('reset-admin');
    const id = ctx.createUser({ email, fullName: 'Empleado Reseteado', roles: ['CASHIER'] });
    await ctx.login(email, VALID_TEST_PASSWORD);

    const response = await ctx
      .post(`/api/v1/users/${id}/reset-password`, { sendEmail: false }, adminToken)
      .expect(200);

    expect(response.body.data.userId).toBe(id);
    expect(response.body.data.sessionsRevoked).toBeGreaterThanOrEqual(1);
    // Lo que se devuelve es un token de un solo uso, no una contraseña.
    expect(typeof response.body.meta.resetToken).toBe('string');
    expect(JSON.stringify(response.body)).not.toContain('temporaryPassword');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');

    // Ese token cambia la contraseña por la vía pública.
    const nueva = 'Elegida#2026';
    await ctx
      .post('/api/v1/auth/reset-password', {
        token: response.body.meta.resetToken,
        password: nueva,
        confirmPassword: nueva,
      })
      .expect(200);
    await ctx.post('/api/v1/auth/login', { email, password: nueva }).expect(200);
  });

  it('soft delete: marca deleted_at, inactiva y revoca sesiones, conservando el histórico', async () => {
    const email = ctx.uniqueEmail('borrado');
    const id = ctx.createUser({ email, fullName: 'Empleado Borrable', roles: ['CASHIER'] });
    const login = await ctx.login(email, VALID_TEST_PASSWORD);

    const response = await ctx.delete(`/api/v1/users/${id}`, adminToken).expect(200);
    expect(response.body.data.id).toBe(id);
    expect(response.body.data.deletedAt).toBeTruthy();
    expect(response.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    // La fila sigue en la base (soft delete) pero ya no se lista ni se ve.
    const fila = ctx.db.prepare('SELECT deleted_at, status FROM users WHERE id = ?').get(id) as {
      deleted_at: string | null;
      status: string;
    };
    expect(fila.deleted_at).not.toBeNull();
    expect(fila.status).toBe('INACTIVE');
    await ctx.get(`/api/v1/users/${id}`, adminToken).expect(404);
    await ctx.post('/api/v1/auth/refresh', { refreshToken: login.refreshToken }).expect(401);
  });

  it('el email duplicado al crear es 409 y al editar también', async () => {
    const emailA = ctx.uniqueEmail('dup-a');
    const emailB = ctx.uniqueEmail('dup-b');
    const idA = ctx.createUser({ email: emailA, fullName: 'Usuario A', roles: ['STAFF'] });
    ctx.createUser({ email: emailB, fullName: 'Usuario B', roles: ['STAFF'] });

    const alta = await ctx
      .post('/api/v1/users', { email: emailA, fullName: 'Duplicado', roles: ['STAFF'] }, adminToken)
      .expect(409);
    expect(alta.body.error.details.code).toBe('EMAIL_TAKEN');

    const edicion = await ctx
      .patch(`/api/v1/users/${idA}`, { email: emailB }, adminToken)
      .expect(409);
    expect(edicion.body.error.details.code).toBe('EMAIL_TAKEN');
  });
});

describe('GET /api/v1/meta/roles', () => {
  it('publica la matriz leída de la base de datos, con 6 roles y los 83 permisos', async () => {
    const response = await ctx.get('/api/v1/meta/roles').expect(200);

    expect(response.body.data.roles.length).toBe(6);
    expect(response.body.data.permissions.length).toBe(83);
    expect(response.body.data.roles.map((role: { name: string }) => role.name)).toEqual([
      'CUSTOMER',
      'STAFF',
      'CASHIER',
      'MANAGER',
      'ADMIN',
      'OWNER',
    ]);

    const matrix = response.body.data.matrix as Record<string, Record<string, string>>;
    // Comprobaciones de contraste: los permisos más dicotómicos de DESIGN.md 9.3.
    expect(matrix['CUSTOMER']?.['auth:register']).toBe('C');
    expect(matrix['ADMIN']?.['auth:register']).toBe('-');
    expect(matrix['CUSTOMER']?.['users:create']).toBe('-');
    expect(matrix['ADMIN']?.['users:create']).toBe('C');
    expect(matrix['OWNER']?.['audit:read']).toBe('C');
    expect(matrix['CASHIER']?.['audit:read']).toBe('-');
    expect(matrix['CASHIER']?.['payments:create']).toBe('C');
    expect(matrix['STAFF']?.['payments:create']).toBe('-');
    expect(matrix['CUSTOMER']?.['orders:create']).toBe('C');

    // Los conteos por rol coinciden con los permisos de la matriz.
    for (const role of response.body.data.roles as { name: string; permissionCount: number }[]) {
      const grants = Object.values(matrix[role.name] ?? {}).filter((mark) => mark !== '-').length;
      expect(role.permissionCount).toBe(grants);
    }
  });

  it('es público: no exige token (BR-RBAC-006)', async () => {
    await ctx.get('/api/v1/meta/roles').expect(200);
  });
});
