/**
 * Harness de pruebas de integración HTTP.
 *
 * ========================= PARA QUÉ SIRVE =========================
 * Levanta la aplicación COMPLETA (misma cadena de middlewares, mismos routers,
 * mismos repositorios) contra una base SQLite EN MEMORIA con las migraciones y
 * las semillas aplicadas, y expone utilidades para autenticar y consultar.
 *
 * Los tests de las fases siguientes (catálogo, pedidos, pagos, espacios) deben
 * reutilizar ESTE fichero, no escribir otro: es la única forma de que la base
 * en memoria, la semilla de RBAC y las cuatro cuentas de sistema sean las
 * mismas en todas las suites.
 *
 * ========================= CÓMO SE USA =============================
 * ```ts
 * import { createTestContext, SYSTEM_TEST_PASSWORD } from './helpers/harness.js';
 *
 * let ctx: TestContext;
 * beforeAll(async () => { ctx = await createTestContext(); });
 * afterAll(() => { ctx.close(); });
 *
 * it('...', async () => {
 *   const token = await ctx.loginAsRole(Role.CASHIER);
 *   const res = await ctx.get('/api/v1/auth/me', token);
 * });
 * ```
 *
 * ===================== AISLAMIENTO ENTRE SUITES =====================
 * vitest ejecuta cada fichero `.spec.ts` en su propio contexto de módulos, así que
 * `config/env.ts` se valida una vez por fichero y este harness puede abrir su
 * base en memoria sin Coordinate con otra suite. Dentro de un mismo fichero se
 * comparte el contexto (y por tanto la base): usa {@link TestContext.uniqueEmail}
 * para no chocar correos entre tests.
 *
 * IMPORTANTE: este fichero debe ser el PRIMER import de cada spec, porque
 * `helpers/test-env.ts` (su primer import) fija el `process.env` que valida
 * `config/env.ts` al importarse.
 */
import './test-env.js';

import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createApp } from '../../src/app.js';
import { getContainer, resetContainerForTests, type Container } from '../../src/config/container.js';
import { closeConnection, getConnection, type Db } from '../../src/shared/database/connection.js';
import { up } from '../../src/shared/database/migrator.js';
import { runSeed } from '../../src/database/seeds/index.js';
import { Role, type Role as RoleValue, type UserContext } from '../../src/shared/domain/index.js';
import { runInTransactionSync } from '../../src/shared/database/unit-of-work.js';
import { hashPassword } from '../../src/modules/auth/password.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { nowIso } from '../../src/shared/utils/datetime.js';
import { AUTH } from '../../src/config/constants.js';

/** `User-Agent` que usan las peticiones del harness. */
export const TEST_USER_AGENT = 'LatteCoffeTests/1.0 (vitest)';

/** Contraseña de las cuentas de sistema sembradas en los tests. */
export const SYSTEM_TEST_PASSWORD = 'LatteCofee#2026';

/** Contraseña válida y distinta, para altas y cambios de contraseña. */
export const VALID_TEST_PASSWORD = 'Cliente#2026';

/** Email del administrador de los tests. */
export const ADMIN_EMAIL = 'admin@lattecoffe.co';

/** Email del propietario de los tests. */
export const OWNER_EMAIL = 'owner@lattecoffe.co';

/** Email del cajero de los tests. */
export const CASHIER_EMAIL = 'cajero@lattecoffe.co';

/** Email del gerente de los tests. */
export const MANAGER_EMAIL = 'manager@lattecoffe.co';

/** Resultado de un login en el harness. */
export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: number;
  readonly userId: number;
  readonly email: string;
}

/** Contexto de pruebas completo. */
export interface TestContext {
  /** App Express lista para `supertest` (sin `listen`). */
  readonly app: Express;
  /** Conexión a la base en memoria, para aserciones directas. */
  readonly db: Db;
  /** Contenedor de dependencias, por si un test necesita un service. */
  readonly container: Container;
  /** Agente de `supertest` para las peticiones. */
  readonly agent: TestAgent;

  /** Email único para un test, derivado de un contador. */
  uniqueEmail(prefix?: string): string;
  /** Hace login y devuelve tokens y usuario. */
  login(email: string, password?: string): Promise<LoginResult>;
  /** Hace login con una de las cuentas de sistema por su rol. */
  loginAsRole(role: RoleValue, password?: string): Promise<LoginResult>;
  /** Atajo: sólo el access token. */
  accessTokenFor(role: RoleValue): Promise<string>;
  /** Contexto `UserContext` sintético, para invocar services sin HTTP. */
  contextFor(role: RoleValue, userId: number, email: string): UserContext;

  /** GET con `Authorization: Bearer` si se pasa token. */
  get(path: string, token?: string): request.Test;
  post(path: string, body?: unknown, token?: string): request.Test;
  patch(path: string, body?: unknown, token?: string): request.Test;
  delete(path: string, token?: string): request.Test;

  /** Crea un usuario con los roles indicados, directamente en la base. */
  createUser(options: CreateUserOptions): number;
  /**
   * Emite un token de reseteo para un usuario existente, usando el MISMO
   * `TokenService` que la API y guardando su hash igual que `forgot-password`.
   *
   * Existe porque en producción el token viaja por correo y aquí no hay
   * proveedor: sin esto, probar `POST /auth/reset-password` exigiría leer el
   * token del log de desarrollo, que es frágil. El endpoint sigue validando el
   * hash y la expiración de verdad, contra datos reales.
   */
  issueResetTokenFor(email: string): string;
  /** Cierra la conexión. Llamar en `afterAll`. */
  close(): void;
}

/** Opciones de {@link TestContext.createUser}. */
export interface CreateUserOptions {
  readonly email: string;
  readonly fullName: string;
  readonly roles: readonly RoleValue[];
  readonly password?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  readonly phone?: string | null;
}

/**
 * Crea la base en memoria, aplica migraciones y semilla, y levanta la app.
 *
 * @param options.disableRateLimit `true` (por defecto) apaga los limitadores de
 *        tasa. El fichero que verifica el 429 debe pasar `false`.
 */
export async function createTestContext(
  options: { readonly disableRateLimit?: boolean } = {},
): Promise<TestContext> {
  const db = getConnection();

  // El esquema y la semilla son los de producción: mismo SQL, misma matriz.
  up();
  const seed = runSeed();
  if (seed.rbac.permissions === 0) {
    throw new Error('La semilla de RBAC no sembró permisos: la matriz está vacía');
  }

  resetContainerForTests();
  const app = createApp({ disableRateLimit: options.disableRateLimit !== false, disableRequestLog: true });
  const container = getContainer();
  // Un `User-Agent` explícito: `supertest` no lo envía, y sin él `device_info`
  // quedaría a NULL en todas las sesiones y el test de `/auth/sessions` no
  // probaría nada del campo que el cliente ve en la UI.
  const agent = request.agent(app).set('User-Agent', TEST_USER_AGENT);

  let sequence = 0;

  const context: TestContext = {
    app,
    db,
    container,
    agent,

    uniqueEmail(prefix = 'user'): string {
      sequence += 1;
      return `${prefix}-${process.pid.toString(36)}-${sequence}@example.test`;
    },

    async login(email, password = SYSTEM_TEST_PASSWORD): Promise<LoginResult> {
      const response = await agent
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return readLoginResponse(response.body);
    },

    async loginAsRole(role: RoleValue, password = SYSTEM_TEST_PASSWORD): Promise<LoginResult> {
      return context.login(emailForRole(role), password);
    },

    async accessTokenFor(role: RoleValue): Promise<string> {
      const result = await context.loginAsRole(role);
      return result.accessToken;
    },

    contextFor(role: RoleValue, userId: number, email: string): UserContext {
      return {
        id: userId,
        email,
        fullName: email,
        businessId: AUTH.DEFAULT_BUSINESS_ID,
        status: 'ACTIVE',
        isStaff: role !== Role.CUSTOMER,
        roles: [role],
        permissions: permissionsOf(role),
      };
    },

    get(path: string, token?: string): request.Test {
      return withToken(agent.get(path), token);
    },
    post(path: string, body?: unknown, token?: string): request.Test {
      return withToken(agent.post(path), token).send(body ?? {});
    },
    patch(path: string, body?: unknown, token?: string): request.Test {
      return withToken(agent.patch(path), token).send(body ?? {});
    },
    delete(path: string, token?: string): request.Test {
      return withToken(agent.delete(path), token);
    },

    createUser(userOptions: CreateUserOptions): number {
      return runInTransactionSync(() => {
        const passwordHash = hashPassword(userOptions.password ?? VALID_TEST_PASSWORD);
        const userId = container.repositories.users.insert({
          email: userOptions.email,
          passwordHash,
          fullName: userOptions.fullName,
          phone: userOptions.phone ?? null,
          photoUrl: null,
          isStaff: userOptions.roles.some((role) => role !== Role.CUSTOMER),
        });
        for (const role of userOptions.roles) {
          const found = container.repositories.users.findRoleByName(role);
          if (found === null) {
            throw new Error(`El rol ${role} no está sembrado: ejecuta la semilla antes de crear usuarios`);
          }
          container.repositories.users.assignRole(userId, found.id);
        }
        container.repositories.users.syncIsStaff(userId);
        if (userOptions.status !== undefined && userOptions.status !== 'ACTIVE') {
          container.repositories.users.updateStatus(userId, userOptions.status);
        }
        return userId;
      });
    },

    issueResetTokenFor(email: string): string {
      const user = container.repositories.auth.findCredentialByEmail(email);
      if (user === null) {
        throw new Error(`No existe el usuario ${email}`);
      }
      // Un `TokenService` propio: el del contenedor es interno a los controllers.
      const tokens = new TokenService(container.repositories.auth);
      const reset = tokens.issuePasswordResetToken();
      container.repositories.auth.setPasswordReset(user.id, reset.tokenHash, reset.expiresAt);
      return reset.token;
    },

    close(): void {
      closeConnection();
    },
  };

  return context;
}

/** Email de la cuenta de sistema de un rol. */
function emailForRole(role: RoleValue): string {
  switch (role) {
    case Role.OWNER:
      return OWNER_EMAIL;
    case Role.ADMIN:
      return ADMIN_EMAIL;
    case Role.MANAGER:
      return MANAGER_EMAIL;
    case Role.CASHIER:
      return CASHIER_EMAIL;
    case Role.STAFF:
      throw new Error(
        'La semilla de despliegue no crea una cuenta STAFF. Cree una con `createUser({ roles: [Role.STAFF] })`.',
      );
    case Role.CUSTOMER:
      throw new Error(
        'La semilla de despliegue no crea una cuenta CUSTOMER. Regístrela con POST /auth/register o use `createUser`.',
      );
    default:
      throw new Error(`Rol no soportado por el harness: ${String(role)}`);
  }
}

/** Lee los tokens de la respuesta de login sin dejar `any` en el código. */
function readLoginResponse(body: unknown): LoginResult {
  if (typeof body !== 'object' || body === null) {
    throw new Error('La respuesta de login no es un objeto');
  }
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    throw new Error('La respuesta de login no trae `data`');
  }
  const record = data as Record<string, unknown>;
  const user = record['user'] as Record<string, unknown> | undefined;
  return {
    accessToken: String(record['accessToken']),
    refreshToken: String(record['refreshToken']),
    sessionId: Number(record['sessionId']),
    userId: Number(user?.['id'] ?? 0),
    email: String(user?.['email'] ?? ''),
  };
}

/** Añade `Authorization: Bearer` cuando hay token. */
function withToken(test: request.Test, token?: string): request.Test {
  return token === undefined ? test : test.set('Authorization', `Bearer ${token}`);
}

/** Permisos efectivos de un rol, leídos de la matriz ya sembrada. */
function permissionsOf(role: RoleValue): string[] {
  const db = getConnection();
  return db
    .prepare(
      `SELECT p.key
         FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p        ON p.id = rp.permission_id
        WHERE r.name = ?
        ORDER BY p.key`,
    )
    .all(role)
    .map((row) => (row as { key: string }).key);
}

/** Instante actual, reexportado para los tests que fechan algo. */
export const testNow = (): string => nowIso();
