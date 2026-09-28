/**
 * Controller del MENÚ PÚBLICO (`GET /api/v1/menu`).
 *
 * Es el ÚNICO controller del proyecto sin `authenticate` en su cadena, junto con
 * `auth`, `health` y `meta` (API.md 2). No lleva `requirePermission` porque el
 * permiso de lectura de catálogo no es lo que se está protegiendo: lo que no se
 * publica son los SKU, los costos, las recetas y los flags de gestión, y eso se
 * resuelve por proyección en `menu.service.ts`, no por un 403.
 *
 * La defensa contra abuso NO es el permiso sino el LÍMITE DE TASA: `menu.routes.ts`
 * monta `menuRateLimit` sobre estas dos rutas, con un presupuesto propio.
 */
import type { Response } from 'express';

import { sendSuccess } from '../../shared/http/index.js';
import type { RequestWithAuth } from '../../shared/middleware/index.js';
import type { MenuFilter, MenuService } from './menu.service.js';
import type { MenuQuery } from './catalog.schemas.js';

/** `req` con la query ya validada. No hay actor: es un endpoint público. */
type MenuRequest = RequestWithAuth & {
  readonly validated?: {
    readonly query?: unknown;
    readonly params?: unknown;
  };
};

/** Controller del menú público. */
export class MenuController {
  public constructor(private readonly menu: MenuService) {}

  /** `GET /api/v1/menu` — categorías activas con sus productos publicables. */
  public list = async (req: MenuRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as MenuQuery;
    const filter: MenuFilter = {
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.featured === undefined ? {} : { featured: query.featured }),
    };
    const categories = this.menu.list(filter);
    sendSuccess(res, categories, {
      total: categories.length,
      productCount: categories.reduce((total, category) => total + category.products.length, 0),
    });
  };

  /**
   * `GET /api/v1/menu/:productId` — un producto del menú con su categoría.
   * 404 si no es publicable: desde fuera, "no existe" y "no está disponible" son
   * la misma respuesta.
   */
  public getProduct = async (req: MenuRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { productId: number };
    sendSuccess(res, this.menu.getProduct(params.productId));
  };
}
