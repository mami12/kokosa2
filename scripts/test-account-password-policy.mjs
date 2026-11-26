import assert from 'node:assert/strict';
import {assertAccountPassword,PLAYER_PASSWORD_PATTERN} from '../server/ledger/account-password-policy.mjs';
for(const pass of ['abc','123','abc123','ABCDEFGHIJ','1234567890','a1B']){
 assert.equal(assertAccountPassword(pass,'PLAYER'),pass);
 assert.equal(PLAYER_PASSWORD_PATTERN.test(pass),true);
}
for(const pass of ['12','ab','','12345678901','abc-123','has space','ççç','😊😊😊']){
 assert.throws(()=>assertAccountPassword(pass,'PLAYER'),{status:400,code:'PLAYER_PASSWORD_INVALID'},pass);
}
assert.equal(assertAccountPassword('staff123','ADMIN'),'staff123');
assert.equal(assertAccountPassword('staff123','AGENT'),'staff123');
assert.equal(assertAccountPassword('staff123','MANAGER'),'staff123');
assert.throws(()=>assertAccountPassword('12','ADMIN'),{status:400,code:'STAFF_PASSWORD_TOO_SHORT'});
assert.equal(assertAccountPassword('123','MANAGER'),'123');
assert.equal(assertAccountPassword('123','ADMIN'),'123');
console.log('PASS user passwords allow 3-digit codes/passwords across player and staff accounts');
