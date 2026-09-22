function enabled(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function mysqlSslConfig() {
  if (!enabled(process.env.MYSQL_SSL)) return undefined;

  const configuredCa = process.env.MYSQL_SSL_CA;
  const ssl = {
    rejectUnauthorized: enabled(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED, true),
  };

  if (configuredCa) ssl.ca = configuredCa.replace(/\\n/g, "\n");
  return ssl;
}
