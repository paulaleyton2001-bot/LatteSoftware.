/**
 * Controller del módulo `catalog` para categorías (API.md 7.10).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no normaliza slugs, no comprueba duplicados, no
 *    reordena. Traduce `req` -> tipos del service y la respuesta -> el envoltorio
 *    de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`, que es el
 *    único que decide el status y el `code`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `businessId` sale SIEMPRE del token (`authenticate` ya lo resolvió): nunca
 *    del body ni de la query (API.md 2).
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { CategoryRequestContext, CategoriesService } from './categories.service.js';
import type { CategoryListFilter, CategorySortColumn } from './categories.repository.js';
import { CATEGORY_SORT_DEFAULT } from './catalog.schemas.js';
import type {
  CreateCategoryBody,
  DeleteCategoryBody,
  ListCategoriesQuery,
  ReorderCategoriesBody,
  UpdateCategoryBody,
} from './catalog.schemas.js';

/** `req` con actor y cuerpo/query/params validados. */
type CategoryRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly CategorySortColumn[] = ['sort_order', 'name', 'created_at'];

/** Contexto de auditoría de la petición. */
function contextOf(req: CategoryRequest): CategoryRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller de categorías. */
export class CategoriesController {
  public constructor(private readonly categories: CategoriesService) {}

  /** `GET /api/v1/categories` — listado paginado por `sort_order`. */
  public list = async (req: CategoryRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListCategoriesQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? CATEGORY_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as CategorySortColumn)
      : (CATEGORY_SORT_DEFAULT as CategorySortColumn);
    const context = contextOf(req);

    const filter: Omit<CategoryListFilter, 'businessId'> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      // `includeInactive` es el interruptor general; `isActive` explícito manda
      // sobre él, igual que en el listado de productos.
      includeInactive:
        query.isActive === undefined ? (query.includeInactive === true) : false,
    };

    const page = this.categories.list({ ...filter, businessId: context.actor.businessId }, context);
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /**
   * `POST /api/v1/categories` — alta (201).
   * `409 CATEGORY_SLUG_TAKEN` si el slug ya existe en el negocio.
   */
  public create = async (req: CategoryRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateCategoryBody;
    const created = this.categories.create(
      {
        name: body.name,
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.imageUrl === undefined ? {} : { imageUrl: body.imageUrl }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        isActive: body.isActive,
      },
      contextOf(req),
    );
    sendCreated(res, created);
  };

  /** `GET /api/v1/categories/:id` — la categoría con sus productos activos. */
  public getById = async (req: CategoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.categories.getById(params.id, contextOf(req)));
  };

  /** `PATCH /api/v1/categories/:id` — edición parcial. */
  public update = async (req: CategoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as UpdateCategoryBody;
    const updated = this.categories.update(
      params.id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.imageUrl === undefined ? {} : { imageUrl: body.imageUrl }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      },
      contextOf(req),
    );
    sendSuccess(res, updated);
  };

  /**
   * `DELETE /api/v1/categories/:id` — baja lógica.
   * `422 CATEGORY_HAS_PRODUCTS` si tiene productos y no se confirma.
   */
  public remove = async (req: CategoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = (req.validated?.body ?? {}) as DeleteCategoryBody;
    const result = this.categories.remove(
      params.id,
      {
        confirmOrphan: body.confirmOrphan === true,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      },
      contextOf(req),
    );
    sendSuccess(res, result);
  };

  /** `POST /api/v1/categories/reorder` — reordenación transaccional del lote. */
  public reorder = async (req: CategoryRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ReorderCategoriesBody;
    sendSuccess(
      res,
      this.categories.reorder(
        body.items.map((item) => ({ id: item.id, sortOrder: item.sortOrder })),
        contextOf(req),
      ),
    );
  };
}
