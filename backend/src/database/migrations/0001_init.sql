-- ==========================================================================
-- 0001_init.sql — Esquema completo de LatteCoffe POS
-- Fuente normativa: docs/DESIGN.md sección 4 "Modelo de datos" (34 tablas).
--
-- CONVENCIONES APLICADAS (DESIGN.md 4.0)
--   PK ................. id INTEGER PRIMARY KEY AUTOINCREMENT
--   Timestamps .......... TEXT ISO-8601 UTC con milisegundos (strftime '%Y-%m-%dT%H:%M:%fZ')
--   updated_at .......... lo refresca el trigger trg_<tabla>_updated_at
--   FKs ................. PRAGMA foreign_keys = ON (abajo) + ON DELETE explícito
--   Money ............... INTEGER en centavos, nunca REAL
--   CHECK de enum ....... en todo campo enumerado: la BD es la última defensa
--   CHECK de JSON ....... json_valid() en las columnas JSON
--   Índices ............. idx_<tabla>_<cols> / ux_<tabla>_<cols>
--   CHECK ............... ck_<tabla>_<regla>
--
-- NOTAS DE PORTABILIDAD (ver informe de la fase 1)
--   1. `updated_at` usa la MISMA expresión por defecto que `created_at`.
--      `DEFAULT (created_at)` es válido en PostgreSQL pero SQLite lo rechaza
--      ("default value of column is not constant"). El trigger mantiene el
--      comportamiento equivalente.
--   2. Los triggers usan `BEGIN ... END;` en su cuerpo. SQLite NO dispara de
--      forma recursiva por defecto (`PRAGMA recursive_triggers = OFF`), así que
--      el UPDATE interno no vuelve a lanzar el trigger.
--
-- REGLAS PARA QUIEN AÑADA MIGRACIONES
--   - Prohibido BEGIN/COMMIT/ROLLBACK/SAVEPOINT: el runner controla la transacción.
--   - Los `PRAGMA` sí están permitidos (son independientes de la transacción).
--   - Un cambio de contenido en un fichero ya aplicado aborta `migrate`:
--     cree una migración nueva (0002_....sql) en lugar de editar esta.
-- ==========================================================================

PRAGMA foreign_keys = ON;

-- ==========================================================================
-- 4.1 IDENTIDAD Y RBAC
-- ==========================================================================

-- Tabla: roles (6 roles de sistema, 1=CUSTOMER … 6=OWNER)
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_roles_name UNIQUE (name),
  CONSTRAINT ck_roles_name CHECK (name IN ('CUSTOMER','STAFF','CASHIER','MANAGER','ADMIN','OWNER')),
  CONSTRAINT ck_roles_is_system CHECK (is_system IN (0, 1))
);

CREATE TRIGGER trg_roles_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW
BEGIN
  UPDATE roles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: permissions (clave `modulo:accion` en minúsculas)
CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  module      TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_permissions_key UNIQUE (key),
  CONSTRAINT ck_permissions_key_format CHECK (instr(key, ':') > 1),
  CONSTRAINT ck_permissions_module CHECK (length(module) > 0)
);

CREATE TRIGGER trg_permissions_updated_at
BEFORE UPDATE ON permissions
FOR EACH ROW
BEGIN
  UPDATE permissions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: role_permissions (PK compuesta)
CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);

-- Tabla: users
-- Nota: `password_hash` es bcrypt. Nunca se devuelve por API ni se registra.
-- Los tokens de reseteo viven aquí (hash sha256), no en una tabla aparte.
CREATE TABLE users (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  email                     TEXT NOT NULL,
  password_hash             TEXT NOT NULL,
  full_name                 TEXT NOT NULL,
  phone                     TEXT,
  photo_url                 TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE',
  email_verified_at         TEXT,
  password_reset_token_hash TEXT,
  password_reset_expires_at TEXT,
  last_login_at             TEXT,
  is_staff                  INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at                TEXT,
  CONSTRAINT ux_users_email UNIQUE (email),
  CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  CONSTRAINT ck_users_is_staff CHECK (is_staff IN (0, 1)),
  CONSTRAINT ck_users_email_lowercase CHECK (email = lower(trim(email)))
);

CREATE INDEX idx_users_status  ON users (status);
CREATE INDEX idx_users_staff   ON users (is_staff, status);
CREATE INDEX idx_users_deleted ON users (deleted_at);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: user_roles
CREATE TABLE user_roles (
  user_id    INTEGER NOT NULL,
  role_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- RESTRICT: no se puede borrar un rol con usuarios asignados.
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
);

CREATE INDEX idx_user_roles_role ON user_roles (role_id);

-- Tabla: refresh_tokens (token opaco; en la BD sólo su sha256)
CREATE TABLE refresh_tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  token_hash     TEXT NOT NULL,
  device_info    TEXT,
  ip_address     TEXT,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  replaced_by_id INTEGER,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_refresh_tokens_token_hash UNIQUE (token_hash),
  FOREIGN KEY (user_id)        REFERENCES users(id)           ON DELETE CASCADE,
  FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL
);

CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens (user_id, revoked_at);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- ==========================================================================
-- 4.2 NEGOCIO
-- ==========================================================================

-- Tabla: businesses (singleton por despliegue en v1; id = 1 sembrado)
CREATE TABLE businesses (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  name                      TEXT NOT NULL,
  legal_name                TEXT,
  logo_url                  TEXT,
  tax_id                    TEXT,
  email                     TEXT,
  phone                     TEXT,
  address_line1             TEXT,
  address_line2             TEXT,
  city                      TEXT,
  country                   TEXT,
  currency_code             TEXT NOT NULL DEFAULT 'COP',
  currency_symbol           TEXT NOT NULL DEFAULT '$',
  locale                    TEXT NOT NULL DEFAULT 'es_CO',
  timezone                  TEXT NOT NULL DEFAULT 'America/Bogota',
  tax_rate_bp               INTEGER NOT NULL DEFAULT 1900,
  tax_inclusive             INTEGER NOT NULL DEFAULT 0,
  service_fee_bp            INTEGER NOT NULL DEFAULT 0,
  tip_enabled               INTEGER NOT NULL DEFAULT 1,
  default_tips_bp           TEXT NOT NULL DEFAULT '1000,1500,2000',
  max_reservation_minutes   INTEGER NOT NULL DEFAULT 480,
  chair_default_price_minor INTEGER NOT NULL DEFAULT 500000,
  allow_negative_stock      INTEGER NOT NULL DEFAULT 0,
  low_stock_alert_threshold INTEGER NOT NULL DEFAULT 5,
  order_prefix              TEXT NOT NULL DEFAULT 'ORD',
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_businesses_tax_rate      CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  CONSTRAINT ck_businesses_service_fee   CHECK (service_fee_bp BETWEEN 0 AND 10000),
  CONSTRAINT ck_businesses_tax_inclusive CHECK (tax_inclusive IN (0, 1)),
  CONSTRAINT ck_businesses_tip_enabled   CHECK (tip_enabled IN (0, 1)),
  CONSTRAINT ck_businesses_negative      CHECK (allow_negative_stock IN (0, 1)),
  CONSTRAINT ck_businesses_max_res       CHECK (max_reservation_minutes > 0),
  CONSTRAINT ck_businesses_chair_price   CHECK (chair_default_price_minor >= 0),
  CONSTRAINT ck_businesses_low_stock     CHECK (low_stock_alert_threshold >= 0)
);

CREATE TRIGGER trg_businesses_updated_at
BEFORE UPDATE ON businesses
FOR EACH ROW
BEGIN
  UPDATE businesses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: locations
CREATE TABLE locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  CONSTRAINT ux_locations_business_name UNIQUE (business_id, name),
  CONSTRAINT ck_locations_is_active CHECK (is_active IN (0, 1)),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_locations_active ON locations (business_id, is_active);

CREATE TRIGGER trg_locations_updated_at
BEFORE UPDATE ON locations
FOR EACH ROW
BEGIN
  UPDATE locations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: business_hours (0=domingo … 6=sábado, convención Date.getDay())
CREATE TABLE business_hours (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  opens_at    TEXT NOT NULL DEFAULT '08:00',
  closes_at   TEXT NOT NULL DEFAULT '20:00',
  is_closed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_business_hours_day UNIQUE (business_id, day_of_week),
  CONSTRAINT ck_business_hours_day     CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT ck_business_hours_closed  CHECK (is_closed IN (0, 1)),
  CONSTRAINT ck_business_hours_opens   CHECK (opens_at  GLOB '[0-2][0-9]:[0-5][0-9]'),
  CONSTRAINT ck_business_hours_closes  CHECK (closes_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_business_hours_updated_at
BEFORE UPDATE ON business_hours
FOR EACH ROW
BEGIN
  UPDATE business_hours SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: business_holidays (`holiday_date` es YYYY-MM-DD en hora local)
CREATE TABLE business_holidays (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id  INTEGER NOT NULL,
  holiday_date TEXT NOT NULL,
  name         TEXT NOT NULL,
  is_closed    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_business_holidays_date UNIQUE (business_id, holiday_date),
  CONSTRAINT ck_business_holidays_date    CHECK (length(holiday_date) = 10),
  CONSTRAINT ck_business_holidays_name    CHECK (length(name) > 0),
  CONSTRAINT ck_business_holidays_closed  CHECK (is_closed IN (0, 1)),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_holidays_date ON business_holidays (business_id, holiday_date);

CREATE TRIGGER trg_business_holidays_updated_at
BEFORE UPDATE ON business_holidays
FOR EACH ROW
BEGIN
  UPDATE business_holidays SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- ==========================================================================
-- 4.3 ESPACIOS (sillas / mesas / barra / áreas)
-- Una sola entidad `chairs` modela toda unidad de espacio alquilable.
-- No existe tabla `tables`.
-- ==========================================================================

-- Tabla: zones
CREATE TABLE zones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT,
  color_hex   TEXT DEFAULT '#6B7280',
  capacity    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  CONSTRAINT ux_zones_location_name UNIQUE (business_id, location_id, name),
  CONSTRAINT ux_zones_business_code  UNIQUE (business_id, code),
  CONSTRAINT ck_zones_is_active CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_zones_capacity   CHECK (capacity >= 0),
  CONSTRAINT ck_zones_name       CHECK (length(name) > 0),
  CONSTRAINT ck_zones_color      CHECK (color_hex IS NULL OR color_hex GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

CREATE INDEX idx_zones_location ON zones (location_id, is_active);
CREATE INDEX idx_zones_active   ON zones (business_id, is_active, sort_order);

CREATE TRIGGER trg_zones_updated_at
BEFORE UPDATE ON zones
FOR EACH ROW
BEGIN
  UPDATE zones SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: chairs
-- `code` es UNIQUE global: es visible para el cliente y se imprime en la
-- señalética física (BR-CHAIR-001).
CREATE TABLE chairs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id               INTEGER NOT NULL,
  code                  TEXT NOT NULL,
  name                  TEXT,
  number_label          TEXT,
  kind                  TEXT NOT NULL DEFAULT 'CHAIR',
  capacity              INTEGER NOT NULL DEFAULT 1,
  price_per_hour_minor  INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'AVAILABLE',
  status_changed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  grid_x                INTEGER NOT NULL DEFAULT 0,
  grid_y                INTEGER NOT NULL DEFAULT 0,
  map_width             INTEGER NOT NULL DEFAULT 1,
  map_height            INTEGER NOT NULL DEFAULT 1,
  rotation_deg          INTEGER NOT NULL DEFAULT 0,
  features              TEXT,
  notes                 TEXT,
  is_bookable           INTEGER NOT NULL DEFAULT 1,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at            TEXT,
  CONSTRAINT ux_chairs_code UNIQUE (code),
  CONSTRAINT ck_chairs_kind      CHECK (kind IN ('CHAIR','TABLE','COUNTER','AREA')),
  CONSTRAINT ck_chairs_status    CHECK (status IN ('AVAILABLE','OCCUPIED','RESERVED','BLOCKED','MAINTENANCE','CLEANING')),
  CONSTRAINT ck_chairs_rotation  CHECK (rotation_deg IN (0, 90, 180, 270)),
  CONSTRAINT ck_chairs_map_w     CHECK (map_width >= 1),
  CONSTRAINT ck_chairs_map_h     CHECK (map_height >= 1),
  CONSTRAINT ck_chairs_capacity  CHECK (capacity >= 1),
  CONSTRAINT ck_chairs_price     CHECK (price_per_hour_minor >= 0),
  CONSTRAINT ck_chairs_bookable  CHECK (is_bookable IN (0, 1)),
  CONSTRAINT ck_chairs_active    CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_chairs_features  CHECK (features IS NULL OR json_valid(features)),
  -- RESTRICT: no se puede borrar una zona con sillas.
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE RESTRICT
);

CREATE INDEX idx_chairs_zone   ON chairs (zone_id, is_active);
CREATE INDEX idx_chairs_status ON chairs (status, is_active);
CREATE INDEX idx_chairs_active ON chairs (is_active, kind);
CREATE INDEX idx_chairs_grid   ON chairs (zone_id, grid_y, grid_x);

CREATE TRIGGER trg_chairs_updated_at
BEFORE UPDATE ON chairs
FOR EACH ROW
BEGIN
  UPDATE chairs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: chair_reservations
-- Nota: `order_id` referencia a `orders`, que se crea después (ciclo
-- deliberado: orders.reservation_id <-> chair_reservations.order_id).
-- SQLite resuelve la FK en el momento del DML, no del DDL.
CREATE TABLE chair_reservations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id         INTEGER NOT NULL,
  location_id         INTEGER NOT NULL,
  zone_id             INTEGER NOT NULL,
  chair_id            INTEGER NOT NULL,
  customer_id         INTEGER,
  order_id            INTEGER,
  code                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  start_at            TEXT NOT NULL,
  end_at              TEXT NOT NULL,
  duration_minutes    INTEGER NOT NULL,
  price_per_hour_minor INTEGER NOT NULL,
  rental_total_minor  INTEGER NOT NULL,
  checked_in_at       TEXT,
  checked_out_at      TEXT,
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  source              TEXT NOT NULL DEFAULT 'STAFF',
  created_by          INTEGER,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_chair_reservations_code UNIQUE (code),
  CONSTRAINT ck_chair_reservations_status CHECK (status IN ('PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','EXPIRED')),
  CONSTRAINT ck_chair_reservations_window CHECK (end_at > start_at),
  CONSTRAINT ck_chair_reservations_duration CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  CONSTRAINT ck_chair_reservations_price CHECK (price_per_hour_minor >= 0),
  CONSTRAINT ck_chair_reservations_total CHECK (rental_total_minor >= 0),
  CONSTRAINT ck_chair_reservations_source CHECK (source IN ('CUSTOMER','STAFF','ADMIN')),
  -- Invariante de check-in (BR-RES-004 y sección 6.2).
  CONSTRAINT ck_chair_reservations_checkin CHECK (status <> 'ACTIVE' OR checked_in_at IS NOT NULL),
  FOREIGN KEY (business_id) REFERENCES businesses(id)       ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id)         ON DELETE RESTRICT,
  FOREIGN KEY (zone_id)     REFERENCES zones(id)             ON DELETE RESTRICT,
  FOREIGN KEY (chair_id)    REFERENCES chairs(id)            ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id)             ON DELETE SET NULL,
  FOREIGN KEY (order_id)    REFERENCES orders(id)            ON DELETE SET NULL,
  FOREIGN KEY (created_by)  REFERENCES users(id)             ON DELETE SET NULL
);

CREATE INDEX idx_res_chair          ON chair_reservations (chair_id, start_at);
CREATE INDEX idx_res_customer       ON chair_reservations (customer_id, start_at);
CREATE INDEX idx_res_status         ON chair_reservations (status, start_at);
CREATE INDEX idx_res_window         ON chair_reservations (chair_id, start_at, end_at);
CREATE INDEX idx_res_business_range ON chair_reservations (business_id, start_at, end_at);

-- ÍNDICE ÚNICO PARCIAL — REGLA CRÍTICA (BR-RES-002)
-- NO previene el solapamiento de intervalos arbitrarios: impide que existan
-- DOS filas CONFIRMED/ACTIVE para la misma silla, sin importar la hora. La
-- prevención real de solapamiento la hace la capa de aplicación, dentro de
-- BEGIN IMMEDIATE, con `NOT (end_at <= :start OR start_at >= :endAt)`.
CREATE UNIQUE INDEX ux_chair_res_active
  ON chair_reservations (chair_id)
 WHERE status IN ('CONFIRMED','ACTIVE');

CREATE TRIGGER trg_chair_reservations_updated_at
BEFORE UPDATE ON chair_reservations
FOR EACH ROW
BEGIN
  UPDATE chair_reservations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: chair_rentals (hecho físico exclusivo e instantáneo)
CREATE TABLE chair_rentals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id           INTEGER NOT NULL,
  chair_id              INTEGER NOT NULL,
  reservation_id        INTEGER,
  customer_id           INTEGER,
  code                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  start_at              TEXT NOT NULL,
  end_at                TEXT NOT NULL,
  planned_minutes       INTEGER NOT NULL,
  billed_minutes        INTEGER NOT NULL,
  price_per_hour_minor  INTEGER NOT NULL,
  subtotal_minor        INTEGER NOT NULL DEFAULT 0,
  extensions_minor      INTEGER NOT NULL DEFAULT 0,
  extra_minutes_minor   INTEGER NOT NULL DEFAULT 0,
  total_minor           INTEGER NOT NULL DEFAULT 0,
  created_by            INTEGER,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_chair_rentals_code UNIQUE (code),
  CONSTRAINT ck_chair_rentals_status  CHECK (status IN ('ACTIVE','EXTENDED','COMPLETED','CANCELLED')),
  CONSTRAINT ck_chair_rentals_window  CHECK (end_at > start_at),
  CONSTRAINT ck_chair_rentals_planned CHECK (planned_minutes > 0),
  CONSTRAINT ck_chair_rentals_billed  CHECK (billed_minutes >= 0),
  CONSTRAINT ck_chair_rentals_price   CHECK (price_per_hour_minor >= 0),
  CONSTRAINT ck_chair_rentals_amounts CHECK (subtotal_minor >= 0 AND extensions_minor >= 0 AND extra_minutes_minor >= 0 AND total_minor >= 0),
  FOREIGN KEY (business_id)    REFERENCES businesses(id)        ON DELETE CASCADE,
  FOREIGN KEY (chair_id)       REFERENCES chairs(id)             ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id) REFERENCES chair_reservations(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id)    REFERENCES users(id)              ON DELETE SET NULL,
  FOREIGN KEY (created_by)     REFERENCES users(id)              ON DELETE SET NULL
);

CREATE INDEX idx_rentals_chair       ON chair_rentals (chair_id, start_at);
CREATE INDEX idx_rentals_customer    ON chair_rentals (customer_id, start_at);
CREATE INDEX idx_rentals_status      ON chair_rentals (status, start_at);
CREATE INDEX idx_rentals_window      ON chair_rentals (chair_id, start_at, end_at);
CREATE INDEX idx_rentals_reservation ON chair_rentals (reservation_id);

-- INVARIANTE: como máximo un alquiler ACTIVE/EXTENDED por silla.
-- Aquí el índice parcial sí es suficiente y exacto (BR-RENTAL-009).
CREATE UNIQUE INDEX ux_chair_rental_active
  ON chair_rentals (chair_id)
 WHERE status IN ('ACTIVE','EXTENDED');

CREATE TRIGGER trg_chair_rentals_updated_at
BEFORE UPDATE ON chair_rentals
FOR EACH ROW
BEGIN
  UPDATE chair_rentals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: chair_rental_extensions (histórico: sin updated_at ni deleted_at)
CREATE TABLE chair_rental_extensions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id         INTEGER NOT NULL,
  chair_id          INTEGER NOT NULL,
  requested_minutes INTEGER NOT NULL,
  previous_end_at   TEXT NOT NULL,
  new_end_at        TEXT NOT NULL,
  additional_minor  INTEGER NOT NULL,
  price_per_hour_minor INTEGER NOT NULL,
  reason            TEXT,
  created_by        INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_rental_extensions_requested  CHECK (requested_minutes > 0),
  CONSTRAINT ck_rental_extensions_window     CHECK (new_end_at > previous_end_at),
  CONSTRAINT ck_rental_extensions_additional CHECK (additional_minor >= 0),
  CONSTRAINT ck_rental_extensions_price      CHECK (price_per_hour_minor >= 0),
  FOREIGN KEY (rental_id)  REFERENCES chair_rentals(id) ON DELETE CASCADE,
  FOREIGN KEY (chair_id)   REFERENCES chairs(id)         ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id)          ON DELETE SET NULL
);

CREATE INDEX idx_rental_extensions_rental ON chair_rental_extensions (rental_id, created_at);

-- ==========================================================================
-- 4.4 CATÁLOGO
-- ==========================================================================

-- Tabla: categories
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  CONSTRAINT ux_categories_business_slug UNIQUE (business_id, slug),
  CONSTRAINT ck_categories_name      CHECK (length(name) > 0),
  CONSTRAINT ck_categories_slug      CHECK (length(slug) > 0),
  CONSTRAINT ck_categories_is_active CHECK (is_active IN (0, 1)),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_categories_active ON categories (business_id, is_active, sort_order);

CREATE TRIGGER trg_categories_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW
BEGIN
  UPDATE categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: products
-- `tax_rate_bp` NULL = hereda businesses.tax_rate_bp (BR-TAX-004).
-- `is_available` es disponibilidad comercial; `is_active` es existencia en el
-- catálogo. Son cosas distintas.
CREATE TABLE products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id         INTEGER NOT NULL,
  category_id         INTEGER,
  sku                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  short_description   TEXT,
  description         TEXT,
  image_url           TEXT,
  base_price_minor    INTEGER NOT NULL,
  promo_price_minor   INTEGER,
  promo_starts_at     TEXT,
  promo_ends_at       TEXT,
  tax_rate_bp         INTEGER,
  track_stock         INTEGER NOT NULL DEFAULT 0,
  is_featured         INTEGER NOT NULL DEFAULT 0,
  is_available        INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1,
  preparation_minutes INTEGER NOT NULL DEFAULT 5,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT,
  CONSTRAINT ux_products_sku  UNIQUE (sku),
  CONSTRAINT ux_products_slug UNIQUE (slug),
  CONSTRAINT ck_products_name       CHECK (length(name) > 0),
  CONSTRAINT ck_products_base_price CHECK (base_price_minor >= 0),
  CONSTRAINT ck_products_promo      CHECK (promo_price_minor IS NULL OR promo_price_minor < base_price_minor),
  CONSTRAINT ck_products_tax_rate   CHECK (tax_rate_bp IS NULL OR tax_rate_bp BETWEEN 0 AND 10000),
  CONSTRAINT ck_products_track      CHECK (track_stock IN (0, 1)),
  CONSTRAINT ck_products_featured   CHECK (is_featured IN (0, 1)),
  CONSTRAINT ck_products_available  CHECK (is_available IN (0, 1)),
  CONSTRAINT ck_products_active     CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_products_prep       CHECK (preparation_minutes >= 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id)  ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id)  ON DELETE SET NULL
);

CREATE INDEX idx_products_category  ON products (category_id, is_active, sort_order);
CREATE INDEX idx_products_active    ON products (business_id, is_active, is_available, sort_order);
CREATE INDEX idx_products_featured  ON products (is_featured, is_active);
CREATE INDEX idx_products_business  ON products (business_id);

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
BEGIN
  UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: product_variants
-- `price_minor` sobreescribe el precio base; `price_delta_minor` puede ser
-- negativa (BR-PRICE-001 y BR-PRICE-009).
CREATE TABLE product_variants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        INTEGER NOT NULL,
  name              TEXT NOT NULL,
  code              TEXT,
  price_delta_minor INTEGER NOT NULL DEFAULT 0,
  price_minor       INTEGER,
  is_default        INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_product_variants_product_name UNIQUE (product_id, name),
  CONSTRAINT ck_product_variants_default CHECK (is_default IN (0, 1)),
  CONSTRAINT ck_product_variants_active  CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_product_variants_price   CHECK (price_minor IS NULL OR price_minor >= 0),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_variants_product ON product_variants (product_id, is_active, sort_order);

CREATE TRIGGER trg_product_variants_updated_at
BEFORE UPDATE ON product_variants
FOR EACH ROW
BEGIN
  UPDATE product_variants SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: product_addons
CREATE TABLE product_addons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT,
  price_minor INTEGER NOT NULL DEFAULT 0,
  is_multiple INTEGER NOT NULL DEFAULT 0,
  max_select  INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_product_addons_product_name UNIQUE (product_id, name),
  CONSTRAINT ck_product_addons_multiple CHECK (is_multiple IN (0, 1)),
  CONSTRAINT ck_product_addons_max      CHECK (max_select IS NULL OR max_select > 0),
  CONSTRAINT ck_product_addons_price     CHECK (price_minor >= 0),
  CONSTRAINT ck_product_addons_active    CHECK (is_active IN (0, 1)),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_addons_product ON product_addons (product_id, is_active, sort_order);

CREATE TRIGGER trg_product_addons_updated_at
BEFORE UPDATE ON product_addons
FOR EACH ROW
BEGIN
  UPDATE product_addons SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: ingredients
CREATE TABLE ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'UND',
  cost_minor  INTEGER NOT NULL DEFAULT 0,
  supplier    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  CONSTRAINT ux_ingredients_business_name UNIQUE (business_id, name),
  CONSTRAINT ck_ingredients_cost  CHECK (cost_minor >= 0),
  CONSTRAINT ck_ingredients_unit  CHECK (unit IN ('UND','KG','G','L','ML')),
  CONSTRAINT ck_ingredients_active CHECK (is_active IN (0, 1)),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_ingredients_active ON ingredients (business_id, is_active);

CREATE TRIGGER trg_ingredients_updated_at
BEFORE UPDATE ON ingredients
FOR EACH ROW
BEGIN
  UPDATE ingredients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: product_ingredients (receta / BOM; NO descuenta stock por sí sola)
CREATE TABLE product_ingredients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity      REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_product_ingredients UNIQUE (product_id, ingredient_id),
  CONSTRAINT ck_product_ingredients_quantity CHECK (quantity > 0),
  FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_ingredients_ingredient ON product_ingredients (ingredient_id);

-- ==========================================================================
-- 4.5 PEDIDOS
-- ==========================================================================

-- Tabla: orders
CREATE TABLE orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id       INTEGER NOT NULL,
  location_id       INTEGER,
  order_number      TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'TAKEAWAY',
  status            TEXT NOT NULL DEFAULT 'DRAFT',
  customer_id       INTEGER,
  chair_id          INTEGER,
  reservation_id    INTEGER,
  rental_id         INTEGER,
  table_label       TEXT,
  channel           TEXT NOT NULL DEFAULT 'POS',
  created_by        INTEGER,
  subtotal_minor    INTEGER NOT NULL DEFAULT 0,
  discount_minor    INTEGER NOT NULL DEFAULT 0,
  tax_minor         INTEGER NOT NULL DEFAULT 0,
  service_fee_minor INTEGER NOT NULL DEFAULT 0,
  total_minor       INTEGER NOT NULL DEFAULT 0,
  paid_minor        INTEGER NOT NULL DEFAULT 0,
  balance_minor     INTEGER NOT NULL DEFAULT 0,
  coupon_code       TEXT,
  notes             TEXT,
  customer_notes    TEXT,
  placed_at         TEXT,
  confirmed_at      TEXT,
  preparing_at      TEXT,
  ready_at          TEXT,
  completed_at      TEXT,
  cancelled_at      TEXT,
  cancel_reason     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  CONSTRAINT ux_orders_order_number UNIQUE (order_number),
  CONSTRAINT ck_orders_type CHECK (type IN ('TAKEAWAY','DINE_IN','CHAIR_RENTAL')),
  CONSTRAINT ck_orders_status CHECK (status IN ('DRAFT','PENDING','CONFIRMED','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED','REFUNDED')),
  CONSTRAINT ck_orders_channel CHECK (channel IN ('COUNTER','MOBILE_WEB','POS')),
  CONSTRAINT ck_orders_amounts CHECK (
    subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0
    AND service_fee_minor >= 0 AND total_minor >= 0 AND paid_minor >= 0
  ),
  -- BR-DISC-002 a nivel de base de datos
  CONSTRAINT ck_orders_discount CHECK (discount_minor <= subtotal_minor),
  -- BR-ORDER-014 a nivel de base de datos: un alquiler exige silla y reserva
  CONSTRAINT ck_orders_rental_requires_chair CHECK (type <> 'CHAIR_RENTAL' OR (chair_id IS NOT NULL AND reservation_id IS NOT NULL)),
  -- BR-ORDER-017: un pedido COMPLETED siempre tiene completed_at
  CONSTRAINT ck_orders_completed_at CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  FOREIGN KEY (business_id)    REFERENCES businesses(id)        ON DELETE CASCADE,
  FOREIGN KEY (location_id)    REFERENCES locations(id)         ON DELETE SET NULL,
  FOREIGN KEY (customer_id)    REFERENCES users(id)             ON DELETE SET NULL,
  FOREIGN KEY (chair_id)       REFERENCES chairs(id)            ON DELETE SET NULL,
  FOREIGN KEY (reservation_id) REFERENCES chair_reservations(id) ON DELETE SET NULL,
  FOREIGN KEY (rental_id)      REFERENCES chair_rentals(id)      ON DELETE SET NULL,
  FOREIGN KEY (created_by)     REFERENCES users(id)             ON DELETE SET NULL
);

CREATE INDEX idx_orders_status     ON orders (business_id, status, created_at DESC);
CREATE INDEX idx_orders_customer   ON orders (customer_id, created_at DESC);
CREATE INDEX idx_orders_chair      ON orders (chair_id, created_at DESC);
CREATE INDEX idx_orders_placed     ON orders (business_id, placed_at DESC);
CREATE INDEX idx_orders_number     ON orders (order_number);
CREATE INDEX idx_orders_type       ON orders (business_id, type, created_at DESC);
CREATE INDEX idx_orders_created_by ON orders (created_by);

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
BEGIN
  UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: order_items
-- Ninguna columna depende del catálogo actual: por eso existen los snapshots
-- (BR-PRICE-004 y BR-PRICE-005).
CREATE TABLE order_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            INTEGER NOT NULL,
  product_id          INTEGER,
  variant_id          INTEGER,
  name_snapshot       TEXT NOT NULL,
  sku_snapshot        TEXT,
  unit_price_minor    INTEGER NOT NULL,
  quantity            REAL NOT NULL DEFAULT 1,
  discount_minor      INTEGER NOT NULL DEFAULT 0,
  tax_minor           INTEGER NOT NULL DEFAULT 0,
  line_total_minor    INTEGER NOT NULL,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  preparation_minutes INTEGER NOT NULL DEFAULT 5,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_order_items_status   CHECK (status IN ('PENDING','READY','CANCELLED')),
  CONSTRAINT ck_order_items_quantity CHECK (quantity > 0),
  CONSTRAINT ck_order_items_price    CHECK (unit_price_minor >= 0),
  CONSTRAINT ck_order_items_line     CHECK (line_total_minor >= 0),
  CONSTRAINT ck_order_items_amounts  CHECK (discount_minor >= 0 AND tax_minor >= 0),
  CONSTRAINT ck_order_items_prep     CHECK (preparation_minutes >= 0),
  FOREIGN KEY (order_id)   REFERENCES orders(id)           ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)         ON DELETE SET NULL,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_order_items_order   ON order_items (order_id, status);
CREATE INDEX idx_order_items_product ON order_items (product_id);

CREATE TRIGGER trg_order_items_updated_at
BEFORE UPDATE ON order_items
FOR EACH ROW
BEGIN
  UPDATE order_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: order_item_addons (histórico: sin updated_at ni deleted_at)
CREATE TABLE order_item_addons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id    INTEGER NOT NULL,
  product_addon_id INTEGER,
  name_snapshot    TEXT NOT NULL,
  price_minor      INTEGER NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_order_item_addons_price CHECK (price_minor >= 0),
  CONSTRAINT ck_order_item_addons_qty   CHECK (quantity > 0),
  FOREIGN KEY (order_item_id)    REFERENCES order_items(id)    ON DELETE CASCADE,
  FOREIGN KEY (product_addon_id) REFERENCES product_addons(id) ON DELETE SET NULL
);

CREATE INDEX idx_order_item_addons_item ON order_item_addons (order_item_id);

-- Tabla: order_status_history (append-only: sin updated_at ni deleted_at)
CREATE TABLE order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  INTEGER,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_order_history_from CHECK (from_status IS NULL OR from_status IN ('DRAFT','PENDING','CONFIRMED','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED','REFUNDED')),
  CONSTRAINT ck_order_history_to   CHECK (to_status   IN ('DRAFT','PENDING','CONFIRMED','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED','REFUNDED')),
  -- BR-ORDER-013: toda transición deja rastro, incluida la cancelación
  CONSTRAINT ck_order_history_reason CHECK (to_status NOT IN ('CANCELLED','REFUNDED') OR reason IS NOT NULL),
  FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_order_history_order ON order_status_history (order_id, created_at);
CREATE INDEX idx_order_history_to   ON order_status_history (to_status, created_at);

-- ==========================================================================
-- 4.6 PAGOS, DESCUENTOS, INVENTARIO, NOTIFICACIONES, AUDITORÍA
-- ==========================================================================

-- Tabla: payments
-- `metadata` jamais contiene PAN, CVV ni tokens del proveedor (BR-SEC-006).
CREATE TABLE payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id         INTEGER NOT NULL,
  order_id            INTEGER,
  payment_number      TEXT NOT NULL,
  method              TEXT NOT NULL,
  provider            TEXT,
  provider_reference  TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  amount_minor        INTEGER NOT NULL,
  refunded_minor      INTEGER NOT NULL DEFAULT 0,
  currency_code       TEXT NOT NULL DEFAULT 'COP',
  reference_number    TEXT,
  receipt_number      TEXT,
  notes               TEXT,
  processed_by        INTEGER,
  customer_id         INTEGER,
  approved_at         TEXT,
  failed_at           TEXT,
  failure_reason      TEXT,
  metadata            TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_payments_payment_number UNIQUE (payment_number),
  CONSTRAINT ck_payments_method CHECK (method IN ('CASH','CARD','TRANSFER','ONLINE')),
  CONSTRAINT ck_payments_provider CHECK (provider IS NULL OR provider IN ('CASH_REGISTRY','STRIPE','MERCADOPAGO','WOMPI','PAYU')),
  CONSTRAINT ck_payments_status CHECK (status IN ('PENDING','APPROVED','FAILED','REFUNDED','PARTIALLY_REFUNDED','CANCELLED')),
  CONSTRAINT ck_payments_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_payments_refunded CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor),
  CONSTRAINT ck_payments_metadata CHECK (metadata IS NULL OR json_valid(metadata)),
  -- Un pago no se borra nunca: RESTRICT sobre el pedido.
  FOREIGN KEY (business_id)  REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id)     REFERENCES orders(id)     ON DELETE RESTRICT,
  FOREIGN KEY (processed_by) REFERENCES users(id)      ON DELETE SET NULL,
  FOREIGN KEY (customer_id)  REFERENCES users(id)      ON DELETE SET NULL
);

CREATE INDEX idx_payments_order     ON payments (order_id, created_at DESC);
CREATE INDEX idx_payments_status    ON payments (business_id, status, created_at DESC);
CREATE INDEX idx_payments_method    ON payments (business_id, method, created_at DESC);
CREATE INDEX idx_payments_customer  ON payments (customer_id, created_at DESC);
CREATE INDEX idx_payments_approved  ON payments (business_id, approved_at);

-- ÍNDICE ÚNICO PARCIAL DE IDEMPOTENCIA (BR-PAY-001)
-- Índice de expresión sobre json_extract. En PostgreSQL se traduce a un
-- índice funcional sobre (metadata->>'idempotency_key').
CREATE UNIQUE INDEX ux_payments_idempotency
  ON payments (json_extract(metadata, '$.idempotency_key'))
 WHERE json_extract(metadata, '$.idempotency_key') IS NOT NULL;

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  UPDATE payments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: payment_refunds (inmutable)
CREATE TABLE payment_refunds (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id          INTEGER NOT NULL,
  order_id            INTEGER,
  amount_minor        INTEGER NOT NULL,
  reason              TEXT NOT NULL,
  refunded_by         INTEGER,
  provider_reference  TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_payment_refunds_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_payment_refunds_reason CHECK (length(reason) > 0),
  FOREIGN KEY (payment_id)  REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id)    REFERENCES orders(id)   ON DELETE SET NULL,
  FOREIGN KEY (refunded_by) REFERENCES users(id)    ON DELETE SET NULL
);

CREATE INDEX idx_refunds_payment ON payment_refunds (payment_id, created_at);
CREATE INDEX idx_refunds_order   ON payment_refunds (order_id);

-- Tabla: discounts
CREATE TABLE discounts (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id                INTEGER NOT NULL,
  code                       TEXT NOT NULL,
  name                       TEXT NOT NULL,
  description                TEXT,
  type                       TEXT NOT NULL,
  value                      INTEGER NOT NULL,
  min_order_minor            INTEGER,
  max_discount_minor         INTEGER,
  applies_to                 TEXT NOT NULL DEFAULT 'ALL',
  applies_category_id        INTEGER,
  applies_product_id         INTEGER,
  usage_limit                INTEGER,
  usage_limit_per_customer   INTEGER,
  used_count                 INTEGER NOT NULL DEFAULT 0,
  starts_at                  TEXT,
  ends_at                    TEXT,
  is_active                  INTEGER NOT NULL DEFAULT 1,
  stackable                  INTEGER NOT NULL DEFAULT 0,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at                 TEXT,
  CONSTRAINT ux_discounts_code UNIQUE (code),
  CONSTRAINT ck_discounts_code        CHECK (code = upper(trim(code)) AND length(code) > 0),
  CONSTRAINT ck_discounts_type        CHECK (type IN ('PERCENT','FIXED')),
  CONSTRAINT ck_discounts_value       CHECK (value >= 0),
  CONSTRAINT ck_discounts_applies     CHECK (applies_to IN ('ALL','CATEGORY','PRODUCT')),
  CONSTRAINT ck_discounts_category    CHECK (applies_to <> 'CATEGORY' OR applies_category_id IS NOT NULL),
  CONSTRAINT ck_discounts_product     CHECK (applies_to <> 'PRODUCT'  OR applies_product_id  IS NOT NULL),
  CONSTRAINT ck_discounts_stackable   CHECK (stackable IN (0, 1)),
  CONSTRAINT ck_discounts_active      CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_discounts_used        CHECK (used_count >= 0),
  CONSTRAINT ck_discounts_max         CHECK (max_discount_minor IS NULL OR max_discount_minor >= 0),
  CONSTRAINT ck_discounts_min         CHECK (min_order_minor IS NULL OR min_order_minor >= 0),
  CONSTRAINT ck_discounts_usage       CHECK (usage_limit IS NULL OR usage_limit > 0),
  CONSTRAINT ck_discounts_usage_cust  CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
  -- Con PERCENT el `value` son basis points: 2000 = 20 %.
  CONSTRAINT ck_discounts_percent_bp  CHECK (type <> 'PERCENT' OR value BETWEEN 0 AND 10000),
  FOREIGN KEY (business_id)         REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (applies_category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (applies_product_id)  REFERENCES products(id)   ON DELETE SET NULL
);

CREATE INDEX idx_discounts_active  ON discounts (business_id, is_active, starts_at, ends_at);
CREATE INDEX idx_discounts_window ON discounts (business_id, starts_at, ends_at);

CREATE TRIGGER trg_discounts_updated_at
BEFORE UPDATE ON discounts
FOR EACH ROW
BEGIN
  UPDATE discounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: discount_redemptions (inmutable)
CREATE TABLE discount_redemptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discount_id  INTEGER NOT NULL,
  order_id     INTEGER NOT NULL,
  customer_id  INTEGER,
  amount_minor INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_discount_redemptions UNIQUE (discount_id, order_id),
  CONSTRAINT ck_discount_redemptions_amount CHECK (amount_minor >= 0),
  FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id)    REFERENCES orders(id)    ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id)     ON DELETE SET NULL
);

CREATE INDEX idx_redemptions_discount ON discount_redemptions (discount_id, created_at);
CREATE INDEX idx_redemptions_customer ON discount_redemptions (customer_id, discount_id);
CREATE INDEX idx_redemptions_order    ON discount_redemptions (order_id);

-- Tabla: inventory_items
-- CHECK de exclusividad exacta: exactamente uno de product_id / ingredient_id.
CREATE TABLE inventory_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id     INTEGER NOT NULL,
  product_id      INTEGER,
  ingredient_id   INTEGER,
  name            TEXT NOT NULL,
  sku             TEXT,
  unit            TEXT NOT NULL DEFAULT 'UND',
  current_stock   REAL NOT NULL DEFAULT 0,
  min_stock       REAL NOT NULL DEFAULT 0,
  max_stock       REAL NOT NULL DEFAULT 0,
  cost_minor      INTEGER NOT NULL DEFAULT 0,
  supplier        TEXT,
  location_storage TEXT,
  is_tracked      INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  CONSTRAINT ck_inventory_items_exclusive CHECK (
    (product_id IS NOT NULL AND ingredient_id IS NULL)
    OR (product_id IS NULL AND ingredient_id IS NOT NULL)
  ),
  CONSTRAINT ck_inventory_items_min_stock  CHECK (min_stock >= 0),
  CONSTRAINT ck_inventory_items_max_stock  CHECK (max_stock >= 0),
  CONSTRAINT ck_inventory_items_cost       CHECK (cost_minor >= 0),
  CONSTRAINT ck_inventory_items_tracked    CHECK (is_tracked IN (0, 1)),
  CONSTRAINT ck_inventory_items_unit       CHECK (unit IN ('UND','KG','G','L','ML')),
  CONSTRAINT ck_inventory_items_name       CHECK (length(name) > 0),
  FOREIGN KEY (business_id)   REFERENCES businesses(id)  ON DELETE CASCADE,
  FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

CREATE INDEX idx_inventory_business  ON inventory_items (business_id, is_tracked);
CREATE INDEX idx_inventory_low_stock ON inventory_items (business_id, min_stock)
 WHERE is_tracked = 1 AND deleted_at IS NULL;

-- ÍNDICES ÚNICOS PARCIALES: un ítem de inventario por producto y por insumo.
CREATE UNIQUE INDEX ux_inventory_product
  ON inventory_items (product_id)
 WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX ux_inventory_ingredient
  ON inventory_items (ingredient_id)
 WHERE ingredient_id IS NOT NULL;

CREATE TRIGGER trg_inventory_items_updated_at
BEFORE UPDATE ON inventory_items
FOR EACH ROW
BEGIN
  UPDATE inventory_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: inventory_movements (inmutable: el saldo se corrige con ADJUSTMENT)
CREATE TABLE inventory_movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id       INTEGER NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  movement_type     TEXT NOT NULL,
  quantity          REAL NOT NULL,
  balance_after     REAL NOT NULL,
  unit_cost_minor   INTEGER,
  reference_type    TEXT,
  reference_id      INTEGER,
  reason            TEXT,
  performed_by      INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_inventory_movements_type CHECK (movement_type IN ('PURCHASE','SALE','ADJUSTMENT','WASTE','RETURN','RESERVATION','RELEASE')),
  CONSTRAINT ck_inventory_movements_qty  CHECK (quantity != 0),
  CONSTRAINT ck_inventory_movements_cost CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
  CONSTRAINT ck_inventory_movements_reason CHECK (movement_type NOT IN ('WASTE','ADJUSTMENT') OR reason IS NOT NULL),
  CONSTRAINT ck_inventory_movements_ref    CHECK (reference_type IS NULL OR reference_type IN ('ORDER','PURCHASE','MANUAL')),
  FOREIGN KEY (business_id)       REFERENCES businesses(id)     ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
  FOREIGN KEY (performed_by)      REFERENCES users(id)          ON DELETE SET NULL
);

CREATE INDEX idx_movements_item      ON inventory_movements (inventory_item_id, created_at DESC);
CREATE INDEX idx_movements_type      ON inventory_movements (business_id, movement_type, created_at DESC);
CREATE INDEX idx_movements_reference ON inventory_movements (reference_type, reference_id);
CREATE INDEX idx_movements_created   ON inventory_movements (business_id, created_at DESC);

-- Tabla: notifications
CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'IN_APP',
  status         TEXT NOT NULL DEFAULT 'PENDING',
  data           TEXT,
  order_id       INTEGER,
  reservation_id INTEGER,
  read_at        TEXT,
  sent_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_notifications_type CHECK (type IN ('ORDER_CONFIRMED','ORDER_READY','RESERVATION_CONFIRMED','RESERVATION_UPCOMING','RESERVATION_TIME_ENDING','RESERVATION_CANCELLED','PAYMENT_SUCCESS','PAYMENT_FAILED','SYSTEM')),
  CONSTRAINT ck_notifications_channel CHECK (channel IN ('IN_APP','PUSH','EMAIL','SMS','WHATSAPP')),
  CONSTRAINT ck_notifications_status  CHECK (status IN ('PENDING','SENT','READ','FAILED')),
  CONSTRAINT ck_notifications_data    CHECK (data IS NULL OR json_valid(data)),
  FOREIGN KEY (user_id)        REFERENCES users(id)             ON DELETE CASCADE,
  FOREIGN KEY (order_id)       REFERENCES orders(id)            ON DELETE CASCADE,
  FOREIGN KEY (reservation_id) REFERENCES chair_reservations(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user        ON notifications (user_id, status, created_at DESC);
CREATE INDEX idx_notifications_unread      ON notifications (user_id) WHERE status <> 'READ';
CREATE INDEX idx_notifications_reservation ON notifications (reservation_id);

-- Tabla: notification_preferences (exactamente una fila por usuario)
CREATE TABLE notification_preferences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  in_app            INTEGER NOT NULL DEFAULT 1,
  push              INTEGER NOT NULL DEFAULT 1,
  email             INTEGER NOT NULL DEFAULT 0,
  sms               INTEGER NOT NULL DEFAULT 0,
  whatsapp          INTEGER NOT NULL DEFAULT 0,
  quiet_hours_from  TEXT,
  quiet_hours_to    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ux_notification_prefs_user UNIQUE (user_id),
  CONSTRAINT ck_notification_prefs_in_app   CHECK (in_app   IN (0, 1)),
  CONSTRAINT ck_notification_prefs_push     CHECK (push     IN (0, 1)),
  CONSTRAINT ck_notification_prefs_email    CHECK (email    IN (0, 1)),
  CONSTRAINT ck_notification_prefs_sms      CHECK (sms      IN (0, 1)),
  CONSTRAINT ck_notification_prefs_whatsapp CHECK (whatsapp IN (0, 1)),
  -- Ambos extremes del horario silencioso o ninguno
  CONSTRAINT ck_notification_prefs_quiet CHECK ((quiet_hours_from IS NULL) = (quiet_hours_to IS NULL)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_notification_preferences_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW
BEGIN
  UPDATE notification_preferences SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
END;

-- Tabla: audit_logs (append-only: nunca se actualiza ni se borra)
-- `before_data` / `after_data` NUNCA contienen password_hash, tokens ni
-- `metadata` de pago.
CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id  INTEGER NOT NULL,
  user_id      INTEGER,
  user_email   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER,
  before_data  TEXT,
  after_data   TEXT,
  ip_address   TEXT,
  user_agent   TEXT,
  request_id   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ck_audit_logs_action CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','LOGIN_FAILED','REFRESH_TOKEN_REUSE','MODIFY_PRODUCT','CHANGE_STATUS','PAYMENT','REFUND','EXPORT','PASSWORD_RESET','ROLE_CHANGE')),
  CONSTRAINT ck_audit_logs_entity_type CHECK (entity_type IN ('user','product','order','chair','reservation','rental','payment','discount','inventory_item','business','export')),
  CONSTRAINT ck_audit_logs_before CHECK (before_data IS NULL OR json_valid(before_data)),
  CONSTRAINT ck_audit_logs_after  CHECK (after_data  IS NULL OR json_valid(after_data)),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE SET NULL
);

CREATE INDEX idx_audit_entity  ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user    ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_action  ON audit_logs (business_id, action, created_at DESC);
