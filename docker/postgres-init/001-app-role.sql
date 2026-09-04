-- The default POSTGRES_USER on the official postgres image is a superuser,
-- and superusers always bypass Row-Level Security regardless of FORCE ROW
-- LEVEL SECURITY. The app must connect as a non-superuser role for RLS
-- (CLAUDE.md §7) to actually take effect, so migrations run as the owner
-- role (erp_test) while the app/tests run as this restricted role.
CREATE ROLE erp_app LOGIN PASSWORD 'erp_app';
GRANT USAGE ON SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
