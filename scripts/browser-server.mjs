import {spawn} from 'node:child_process';
import {browserEnv} from './browser-env.mjs';

// Запускает отдельный сервер на фиксированном тестовом порту с изолированным окружением.
const args = process.env.BROWSER_PRODUCTION === '1' ? ['scripts/start.mjs'] : ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '13300'];
const child = spawn(process.execPath, args, {stdio: 'inherit', env: {...process.env, ...browserEnv, KONTUR_HOST: '127.0.0.1', KONTUR_PORT: '13300'}});
child.on('exit', code => {process.exitCode = code ?? 1;});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
