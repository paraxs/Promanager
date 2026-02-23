import crypto from 'node:crypto';

const createKey = (role) => `${role}_${crypto.randomBytes(24).toString('hex')}`;

const owner = createKey('owner');
const dispatcher = createKey('dispatcher');
const readonly = createKey('readonly');

console.log('SECURITY_OWNER_KEYS=' + owner);
console.log('SECURITY_DISPATCHER_KEYS=' + dispatcher);
console.log('SECURITY_READONLY_KEYS=' + readonly);
