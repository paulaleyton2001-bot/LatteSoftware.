/**
 * Servicio de clientes: casos de uso de `/api/v1/customers/*` (API.md 7.3).
 *
 * ===================== ALCANCE Y AISLAMIENTO ================================
 * La matriz de RBAC da `customers:read` y `customers:update` con marca `P` (parcial)
 * al `CUSTOMER`: el middleware resuelve que tiene el permiso y el SERVICE
 * resuelve el alcance (DESIGN.md 9.3). Reglas:
 *  - Un `CUSTOMER` NO puede listar el directorio de clientes (403): el listado es
 *    una herramienta de sala; sus propios datos están en `GET /customers/me`.
 *  - Un `CUSTOMER` que pide `/customers/:id` de OTRO usuario recibe 404, no 403:
 *    API.md 2 reserva el 403 para `/users/*` y aquí la existencia de otro cliente
 *    no es información que deba revelar.
 *  - Un empleado (`CASHIER`, `MANAGER`, `ADMIN`, `OWNER`) sí ve cualquier cliente.
 *  - Un `CUSTOMER` no puede cambiar su propio email por esta vía (422): exige
 *    verificación, que es el flujo de `forgot-password` / confirmación.
 *
 * Cada escritura y cada lectura sensible deja fila en `audit_logs` (BR-SEC-007).
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { AuditAction, AuditEntityType, Role, UserStatus, isEnumValue } from '../../shared/domain/index.js';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../shared/errors/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import type { CustomerListFilter, CustomerRow, CustomersRepository } from './customers.repository.js';
import type { CustomerPage, CustomerPatch, CustomerView } from './customers.types.js';

/** Roles con alcance de operador sobre el directorio de clientes. */
const OPERATOR_ROLES: readonly Role[] = [Role.CASHIER, Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Contexto de la petición para auditoría. */
export interface CustomersRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Servicio de clientes. */
export class CustomersService {
  public constructor(
    private readonly repository: CustomersRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /customers` — directorio de clientes.
   *
   * Un `CUSTOMER` recibe 403: el permiso `customers:read` existe para él con
   * alcance parcial, y el alcance de un listado es la lista completa, no "la
   * parte que le corresponde". Para lo propio está `GET /customers/me`.
   */
  public list(filter: CustomerListFilter, context: CustomersRequestContext): CustomerPage {
    this.assertOperator(context.actor);

    const rows = this.repository.list(filter);
    const items = rows.map((row) => this.toView(row));
    return { items, total: this.repository.count(filter) };
  }

  /**
   * `GET /customers/:id` — ficha de un cliente con estadísticas.
   *
   * 404 para un cliente que no existe, que está borrado lógicamente, que no tiene
   * el rol `CUSTOMER`, o que es otro cliente distinto del actor.
   */
  public getById(id: number, context: CustomersRequestContext): CustomerView {
    this.assertCanAccessCustomer(id, context.actor);
    const row = this.requireCustomer(id);
    return this.toView(row);
  }

  /**
   * `GET /customers/me` — ficha del cliente autenticado.
   *
   * 404 si el actor no es cliente (un `ADMIN` que llama aquí no tiene ficha de
   * cliente; su perfil de usuario está en `GET /auth/me`).
   */
  public me(context: CustomersRequestContext): CustomerView {
    const row = this.requireCustomer(context.actor.id);
    return this.toView(row);
  }

  // ==========================================================================
  // Escrituras
  // ==========================================================================

  /**
   * `PATCH /customers/:id` — nombre, teléfono, foto y (sólo operador) email.
   *
   * El alcance es el mismo que en la lectura: un cliente edita el suyo, un
   * operador edita cualquiera. El email propio de un cliente se rechaza con 422
   * porque cambiarlo exige verificación de la dirección nueva.
   */
  public update(id: number, patch: CustomerPatch, context: CustomersRequestContext): CustomerView {
    this.assertCanAccessCustomer(id, context.actor);
    const isSelf = id === context.actor.id;

    if (isSelf && patch.email !== undefined) {
      throw new BusinessRuleError(
        'No puede cambiar su propio correo: debe verificar la dirección nueva',
        {
          details: {
            code: 'EMAIL_CHANGE_REQUIRES_VERIFICATION',
            field: 'email',
            hint: 'Use POST /api/v1/auth/forgot-password con la dirección nueva.',
          },
        },
      );
    }

    if (patch.email !== undefined) {
      const owner = this.repository.findIdByEmail(patch.email);
      if (owner !== null && owner !== id) {
        throw new ConflictError('Ya existe una cuenta con ese correo electrónico', {
          details: { code: 'EMAIL_TAKEN', field: 'email' },
        });
      }
    }

    return runInTransactionSync(() => {
      const before = this.requireCustomer(id);
      this.repository.update(id, patch);
      const after = this.requireCustomer(id);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.user,
        entityId: id,
        actor: { id: context.actor.id, email: context.actor.email, businessId: context.actor.businessId },
        request: context.request,
        beforeData: { id: before.id, fullName: before.full_name, phone: before.phone, email: before.email },
        afterData: { id: after.id, fullName: after.full_name, phone: after.phone, email: after.email },
      });

      return this.toView(after);
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /** Cliente obligatorio: 404 si no es un cliente. */
  private requireCustomer(id: number): CustomerRow {
    const row = this.repository.findById(id);
    if (row === null) {
      throw new NotFoundError('El cliente no existe', { details: { id, type: 'customer' } });
    }
    return row;
  }

  /**
   * Comprueba el alcance de lectura/escritura sobre un cliente concreto.
   * Un operador pasa siempre; un cliente sólo sobre sí mismo, y un `404` evita
   * confirmar que el otro cliente existe.
   */
  private assertCanAccessCustomer(id: number, actor: UserContext): void {
    if (actor.roles.some((role) => OPERATOR_ROLES.includes(role))) {
      return;
    }
    if (id !== actor.id) {
      throw new NotFoundError('El cliente no existe', { details: { id, type: 'customer' } });
    }
  }

  /** El listado exige rol de operador. */
  private assertOperator(actor: UserContext): void {
    if (actor.roles.some((role) => OPERATOR_ROLES.includes(role))) {
      return;
    }
    throw new AuthorizationError('No tiene permisos para listar clientes', {
      details: {
        code: 'INSUFFICIENT_ROLE',
        required: [...OPERATOR_ROLES],
        actual: [...actor.roles],
      },
    });
  }

  /** Proyecta la fila de `users` a la vista de cliente, con sus estadísticas. */
  private toView(row: CustomerRow): CustomerView {
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      photoUrl: row.photo_url,
      // Un `status` desconocido (imposible con el CHECK de la tabla) degrada a
      // INACTIVE en vez de filtrar un valor crudo hacia la API.
      status: isEnumValue(UserStatus, row.status) ? row.status : UserStatus.INACTIVE,
      roles: this.repository.listRoleNames(row.id),
      emailVerifiedAt: row.email_verified_at,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stats: this.repository.stats(row.id),
    };
  }
}
