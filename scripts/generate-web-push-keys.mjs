import webpush from 'web-push';
const keys = webpush.generateVAPIDKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}`);
console.error('Сохраните одну пару ключей в секретах app и worker. Приватный ключ не добавляйте в Git.');
