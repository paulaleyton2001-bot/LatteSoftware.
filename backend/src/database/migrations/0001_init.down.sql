-- ==========================================================================
-- 0001_init.down.sql — Reversión de 0001_init.sql
--
-- La usa `npm run migrate:rollback`. Borra los triggers, los índices y las
-- 34 tablas en orden inverso de dependencias. Tras la reversión, el esquema
-- vuelve a estar vacío y `npm run migrate` puede reaplicar 0001_init.sql.
--
-- `PRAGMA foreign_keys = OFF` dentro de una transacción es una no-op en
-- SQLite (no se puede cambiar el modo de FKs con una transacción abierta), y
-- no hace falta: el orden de borrado respeta las dependencias.
-- ==========================================================================

PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS trg_roles_updated_at;
DROP TRIGGER IF EXISTS trg_permissions_updated_at;
DROP TRIGGER IF EXISTS trg_users_updated_at;
DROP TRIGGER IF EXISTS trg_refresh_tokens_updated_at;
DROP TRIGGER IF EXISTS trg_businesses_updated_at;
DROP TRIGGER IF EXISTS trg_locations_updated_at;
DROP TRIGGER IF EXISTS trg_business_hours_updated_at;
DROP TRIGGER IF EXISTS trg_business_holidays_updated_at;
DROP TRIGGER IF EXISTS trg_zones_updated_at;
DROP TRIGGER IF EXISTS trg_chairs_updated_at;
DROP TRIGGER IF EXISTS trg_chair_reservations_updated_at;
DROP TRIGGER IF EXISTS trg_chair_rentals_updated_at;
DROP TRIGGER IF EXISTS trg_categories_updated_at;
DROP TRIGGER IF EXISTS trg_products_updated_at;
DROP TRIGGER IF EXISTS trg_product_variants_updated_at;
DROP TRIGGER IF EXISTS trg_product_addons_updated_at;
DROP TRIGGER IF EXISTS trg_ingredients_updated_at;
DROP TRIGGER IF EXISTS trg_order_items_updated_at;
DROP TRIGGER IF EXISTS trg_orders_updated_at;
DROP TRIGGER IF EXISTS trg_payments_updated_at;
DROP TRIGGER IF EXISTS trg_discounts_updated_at;
DROP TRIGGER IF EXISTS trg_inventory_items_updated_at;
DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at;
DROP TRIGGER IF EXISTS trg_audit_entity;
DROP TRIGGER IF EXISTS trg_audit_user;
DROP TRIGGER IF EXISTS trg_audit_created;
DROP TRIGGER IF EXISTS trg_audit_action;
DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at;
DROP TRIGGER IF EXISTS trg_inventory_items_updated_at;
DROP TRIGGER IF EXISTS trg_discounts_updated_at;
DROP TRIGGER IF EXISTS trg_payments_updated_at;
DROP TRIGGER IF EXISTS trg_orders_updated_at;
DROP TRIGGER IF EXISTS trg_order_items_updated_at;
DROP TRIGGER IF EXISTS trg_product_ingredients_updated_at;
DROP TRIGGER IF EXISTS trg_ingredients_updated_at;
DROP TRIGGER IF EXISTS trg_product_addons_updated_at;
DROP TRIGGER IF EXISTS trg_product_variants_updated_at;
DROP TRIGGER IF EXISTS trg_products_updated_at;
DROP TRIGGER IF EXISTS trg_categories_updated_at;
DROP TRIGGER IF EXISTS trg_chair_rentals_updated_at;
DROP TRIGGER IF EXISTS trg_chair_reservations_updated_at;
DROP TRIGGER IF EXISTS trg_chairs_updated_at;
DROP TRIGGER IF EXISTS trg_zones_updated_at;
DROP TRIGGER IF EXISTS trg_business_holidays_updated_at;
DROP TRIGGER IF EXISTS trg_business_hours_updated_at;
DROP TRIGGER IF EXISTS trg_locations_updated_at;
DROP TRIGGER IF EXISTS trg_businesses_updated_at;
DROP TRIGGER IF EXISTS trg_refresh_tokens_updated_at;
DROP TRIGGER IF EXISTS trg_users_updated_at;
DROP TRIGGER IF EXISTS trg_permissions_updated_at;
DROP TRIGGER IF EXISTS trg_roles_updated_at;

-- Índices explícitos. Los índices internos de `UNIQUE` y las claves primarias
-- caen solos con sus tablas.
DROP INDEX IF EXISTS idx_audit_action;
DROP INDEX IF EXISTS idx_audit_created;
DROP INDEX IF EXISTS idx_audit_entity;
DROP INDEX IF EXISTS idx_audit_user;
DROP INDEX IF EXISTS idx_notifications_reservation;
DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_notifications_user;
DROP INDEX IF EXISTS ux_inventory_ingredient;
DROP INDEX IF EXISTS ux_inventory_product;
DROP INDEX IF EXISTS idx_inventory_low_stock;
DROP INDEX IF EXISTS idx_inventory_business;
DROP INDEX IF EXISTS idx_movements_created;
DROP INDEX IF EXISTS idx_movements_reference;
DROP INDEX IF EXISTS idx_movements_type;
DROP INDEX IF EXISTS idx_movements_item;
DROP INDEX IF EXISTS idx_redemptions_order;
DROP INDEX IF EXISTS idx_redemptions_customer;
DROP INDEX IF EXISTS idx_redemptions_discount;
DROP INDEX IF EXISTS idx_discounts_window;
DROP INDEX IF EXISTS idx_discounts_active;
DROP INDEX IF EXISTS ux_payments_idempotency;
DROP INDEX IF EXISTS idx_payments_approved;
DROP INDEX IF EXISTS idx_payments_customer;
DROP INDEX IF EXISTS idx_payments_method;
DROP INDEX IF EXISTS idx_payments_status;
DROP INDEX IF EXISTS idx_payments_order;
DROP INDEX IF EXISTS idx_refunds_order;
DROP INDEX IF EXISTS idx_refunds_payment;
DROP INDEX IF EXISTS idx_order_history_to;
DROP INDEX IF EXISTS idx_order_history_order;
DROP INDEX IF EXISTS idx_order_item_addons_item;
DROP INDEX IF EXISTS idx_order_items_product;
DROP INDEX IF EXISTS idx_order_items_order;
DROP INDEX IF EXISTS idx_orders_created_by;
DROP INDEX IF EXISTS idx_orders_type;
DROP INDEX IF EXISTS idx_orders_number;
DROP INDEX IF EXISTS idx_orders_placed;
DROP INDEX IF EXISTS idx_orders_chair;
DROP INDEX IF EXISTS idx_orders_customer;
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_product_ingredients_ingredient;
DROP INDEX IF EXISTS idx_ingredients_active;
DROP INDEX IF EXISTS idx_addons_product;
DROP INDEX IF EXISTS idx_variants_product;
DROP INDEX IF EXISTS idx_products_business;
DROP INDEX IF EXISTS idx_products_featured;
DROP INDEX IF EXISTS idx_products_active;
DROP INDEX IF EXISTS idx_products_category;
DROP INDEX IF EXISTS idx_categories_active;
DROP INDEX IF EXISTS idx_rental_extensions_rental;
DROP INDEX IF EXISTS ux_chair_rental_active;
DROP INDEX IF EXISTS idx_rentals_reservation;
DROP INDEX IF EXISTS idx_rentals_window;
DROP INDEX IF EXISTS idx_rentals_status;
DROP INDEX IF EXISTS idx_rentals_customer;
DROP INDEX IF EXISTS idx_rentals_chair;
DROP INDEX IF EXISTS ux_chair_res_active;
DROP INDEX IF EXISTS idx_res_business_range;
DROP INDEX IF EXISTS idx_res_window;
DROP INDEX IF EXISTS idx_res_status;
DROP INDEX IF EXISTS idx_res_customer;
DROP INDEX IF EXISTS idx_res_chair;
DROP INDEX IF EXISTS idx_chairs_grid;
DROP INDEX IF EXISTS idx_chairs_active;
DROP INDEX IF EXISTS idx_chairs_status;
DROP INDEX IF EXISTS idx_chairs_zone;
DROP INDEX IF EXISTS idx_zones_active;
DROP INDEX IF EXISTS idx_zones_location;
DROP INDEX IF EXISTS idx_holidays_date;
DROP INDEX IF EXISTS idx_user_roles_role;
DROP INDEX IF EXISTS idx_users_deleted;
DROP INDEX IF EXISTS idx_users_staff;
DROP INDEX IF EXISTS idx_users_status;
DROP INDEX IF EXISTS idx_role_permissions_permission;
DROP INDEX IF EXISTS idx_refresh_tokens_expires;
DROP INDEX IF EXISTS idx_refresh_tokens_user;
DROP INDEX IF EXISTS idx_locations_active;

-- Tablas, en orden inverso de dependencias.
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS inventory_movements;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS discount_redemptions;
DROP TABLE IF EXISTS discounts;
DROP TABLE IF EXISTS payment_refunds;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_status_history;
DROP TABLE IF EXISTS order_item_addons;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS product_ingredients;
DROP TABLE IF EXISTS ingredients;
DROP TABLE IF EXISTS product_addons;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS chair_rental_extensions;
DROP TABLE IF EXISTS chair_rentals;
DROP TABLE IF EXISTS chair_reservations;
DROP TABLE IF EXISTS chairs;
DROP TABLE IF EXISTS zones;
DROP TABLE IF EXISTS business_holidays;
DROP TABLE IF EXISTS business_hours;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS businesses;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
