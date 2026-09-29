/**
 * Construcción del CSV de `POST /api/v1/reports/export` (API.md 7.16).
 *
 * ============================================================================
 * FORMATO (el que pide el contrato)
 * ============================================================================
 *  - **BOM UTF-8** (`\xEF\xBB\xBF`) al principio: sin él, Excel en Windows
 *    interpreta el fichero como ANSI y "LatteCoffe" sale con la `é` rota.
 *  - **Separador `;`** (convención `es_CO`) y **fin de línea CRLF**, que es lo
 *    que espera Excel en Windows.
 *  - Cabecera `text/csv; charset=utf-8` y `Content-Disposition: attachment`.
 *
 * ============================================================================
 * INYECCIÓN DE FÓRMULAS: LA PARTE DE SEGURIDAD
 * ============================================================================
 * Una celda que empieza por `=`, `+`, `-` o `@` la interpretan Excel,
 * LibreOffice y Google Sheets como el inicio de una FÓRMULA. Un producto
 * llamado `=cmd|'/c calc'!A1` se ejecutaría al abrir el fichero, en la máquina
 * de quien lo abrió. Es un ataque real contra un panel de administración, y
 * este módulo se exporta precisamente porque es donde más datos sensibles hay.
 *
 * Mitigación: se antepone un apóstrofo (`'`) a toda celda de TEXTO que empiece
 * por cualquiera de esos cuatro caracteres. El apóstrofo es el carácter de
 * escape estándar de Excel: el texto se muestra tal cual y NO se evalúa.
 *
 * **Las celdas NUMÉRICAS no se escapan.** Un importe negativo (`-5000`) es un
 * número, no una fórmula, y anteponerle un apóstrofo lo convertiría en texto
 * y rompería la columna de totales. Los números los genera el servidor a
 * partir de enteros de centavos, nunca vienen del cliente, así que no son un
 * vector de inyección. Sólo se escapa texto, y ese texto sí viene del catálogo
 * (nombre de producto) o del cliente (nombre, notas).
 *
 * ============================================================================
 * COMILLAS
 * ============================================================================
 * Se entrecomilla una celda si contiene el separador, una comilla doble, un
 * salto de línea o espacios al principio o al final. Las comillas dobles
 * internas se duplican, como exige RFC 4180.
 */
import { BusinessRuleError, ValidationError } from '../../shared/errors/index.js';
import { roundHalfUp } from '../../shared/utils/money.js';
import type { CsvExport, ExportColumn } from './reports.types.js';

/** Separador de campos: convención `es_CO`. */
const SEPARATOR = ';';

/** Fin de línea: CRLF, que es lo que espera Excel en Windows. */
const EOL = '\r\n';

/** BOM UTF-8 para que Excel en Windows respete los acentos. */
const BOM = '﻿';

/** Tope de tamaño del CSV, en bytes (API.md 7.16). */
export const EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Tope de filas del CSV (API.md 7.16). */
export const EXPORT_MAX_ROWS = 100_000;

/** Caracteres que hacen que una hoja de cálculo interprete la celda como fórmula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@'] as const;

/**
 * ¿Es esta celda un intento de fórmula?
 *
 * Se mira el PRIMER carácter, pero también se ignoran los espacios y los
 * tabuladores iniciales: Excel los descarta antes de evaluar, de modo que
 * `" =1+1"` también es una fórmula.
 */
export function looksLikeFormula(value: string): boolean {
  const trimmed = value.replace(/^[\s\u0000-\u001f]+/, '');
  if (trimmed.length === 0) return false;
  const first = trimmed.charAt(0);
  return FORMULA_PREFIXES.includes(first as (typeof FORMULA_PREFIXES)[number]);
}

/**
 * Escapa una celda de TEXTO contra la inyección de fórmulas.
 *
 * Antepone un apóstrofo si el texto empieza por `=`, `+`, `-` o `@`.
 * Devuelve el texto ya entrecomillado si necesita comillas por el separador.
 */
export function escapeCsvText(value: string): string {
  const guarded = looksLikeFormula(value) ? `'${value}` : value;
  return quoteIfNeeded(guarded);
}

/** Entrecomilla si la celda lo necesita, duplicando las comillas internas. */
function quoteIfNeeded(value: string): string {
  const needsQuotes =
    value.includes(SEPARATOR) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim();
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Formatea una celda de NÚMERO entero.
 *
 * No se escapa contra fórmulas: es un entero que produce el servidor. Los
 * negativos conservan su signo, que es lo correcto para una columna contable.
 */
export function formatCsvInteger(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = roundHalfUp(value);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Una celda del CSV: texto (se escapa) o número entero (no se escapa). */
export type CsvCell = string | number | null | undefined;

/** Convierte una celda al texto final de la línea del CSV. */
function renderCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return formatCsvInteger(cell);
  return escapeCsvText(cell);
}

/** Columna de un reporte, con su rótulo y su extractor. */
export interface ReportColumnSpec extends ExportColumn {
  /** Lee el valor de la columna en una fila del reporte. */
  readonly value: (row: Record<string, unknown>) => CsvCell;
}

/**
 * Construye el CSV completo de un reporte.
 *
 * @param spec       Columnas del reporte, en el orden en que se publicarán.
 * @param rows       Filas ya calculadas por el service.
 * @param totalRow   Fila de totales opcional (`includeTotalsRow`).
 * @param requested  Subconjunto de claves pedido por el cliente (`columns`).
 * @param baseName   Nombre base sin extensión.
 */
export function buildCsv(
  spec: readonly ReportColumnSpec[],
  rows: readonly Record<string, unknown>[],
  totalRow: Record<string, unknown> | null,
  requested: readonly string[] | undefined,
  baseName: string,
): CsvExport {
  const columns = selectColumns(spec, requested);
  const lines: string[] = [columns.map((column) => escapeCsvText(column.label)).join(SEPARATOR)];

  for (const row of rows) {
    lines.push(columns.map((column) => renderCell(column.value(row))).join(SEPARATOR));
  }
  if (totalRow !== null) {
    lines.push(columns.map((column) => renderCell(column.value(totalRow))).join(SEPARATOR));
  }

  const body = `${lines.join(EOL)}${EOL}`;
  // El BOM se cuenta aparte: es un carácter de control, no contenido.
  const byteLength = Buffer.byteLength(BOM + body, 'utf8');
  if (byteLength > EXPORT_MAX_BYTES || rows.length > EXPORT_MAX_ROWS) {
    // 422 `EXPORT_TOO_LARGE` (API.md 7.16): la petición es válida, el
    // resultado es el que no cabe.
    throw new BusinessRuleError('El reporte es demasiado grande para exportarlo', {
      details: [
        {
          path: 'report',
          message: `Acote el rango o filtre más: el máximo son ${EXPORT_MAX_ROWS.toLocaleString('es-CO')} filas y ${Math.floor(EXPORT_MAX_BYTES / (1024 * 1024))} MB`,
          code: 'EXPORT_TOO_LARGE',
        },
      ],
    });
  }

  return {
    filename: `${sanitizeFilename(baseName)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: BOM + body,
    rows: rows.length,
    columns: columns.map((column) => column.key),
    byteLength,
  };
}

/**
 * Aplica el subconjunto de columnas pedido por el cliente.
 *
 * Una clave desconocida es un `400 INVALID_COLUMNS`: si se ignorara en
 * silencio, el cliente creería que descargó un archivo con todos los datos
 * cuando en realidad le faltan columnas.
 */
export function selectColumns(
  spec: readonly ReportColumnSpec[],
  requested: readonly string[] | undefined,
): readonly ReportColumnSpec[] {
  if (requested === undefined || requested.length === 0) return spec;
  const byKey = new Map(spec.map((column) => [column.key, column]));
  return requested.map((key) => {
    const found = byKey.get(key);
    if (found === undefined) {
      throw new ValidationError('Las columnas solicitadas no son válidas', {
        details: [
          {
            path: 'columns',
            message: `"${key}" no es una columna de este reporte`,
            code: 'INVALID_COLUMNS',
          },
        ],
      });
    }
    return found;
  });
}

/**
 * Sanea el nombre de fichero pedido por el cliente.
 *
 * Nunca se interpola en una cabecera sin limpiar: un `filename` con comillas o
 * saltos de línea rompería la cabecera `Content-Disposition` y, peor, podría
 * inyectar cabeceras HTTP.
 */
export function sanitizeFilename(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["\\/\r\n]/g, '-')
    .replace(/\.csv$/i, '')
    .trim();
  return cleaned.length === 0 ? 'reporte' : cleaned.slice(0, 120);
}
