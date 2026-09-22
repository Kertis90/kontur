#!/bin/sh
set -eu

if [ "${AUTO_MIGRATE:-true}" = "true" ]; then
  node scripts/migrate.mjs
fi

if [ "${AUTO_SEED:-true}" = "true" ]; then
  node scripts/seed.mjs
fi

if [ "${APP_PROCESS:-web}" = "worker" ]; then
  exec node scripts/worker.mjs
fi

if [ "${APP_PROCESS:-web}" = "recording-worker" ]; then
  exec node scripts/recording-worker.mjs
fi

exec node server.js
