-- Создаёт отдельного пользователя приложения без административных прав сервера.
\getenv app_user POSTGRES_APP_USER
\getenv app_password POSTGRES_APP_PASSWORD
\getenv app_database POSTGRES_DB
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_user', :'app_password') \gexec
ALTER DATABASE :"app_database" OWNER TO :"app_user";
REVOKE ALL ON DATABASE :"app_database" FROM PUBLIC;
ALTER SCHEMA public OWNER TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
