import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const admin=readFileSync('public/admin.js','utf8');
const html=readFileSync('public/admin.html','utf8');
const settings=readFileSync('public/account-settings.js','utf8');
const auth=readFileSync('lib/teacher-auth.mjs','utf8');
const users=readFileSync('lib/user-management.mjs','utf8');
// Sign-up must compare both password fields before creating an account.
assert.match(admin,/if \(authMode === 'register' && password !== \$\('auth-password2'\)\.value\) \{\s*status\('auth-status', 'The passwords do not match\.', true\);\s*return;\s*\}/);
// Keyboard focus must not escape a modal dialog.
assert.match(admin,/const focusable = 'a\[href\],button:not\(\[disabled\]\)/);
assert.match(admin,/if \(event\.key !== 'Tab'\) return;/);
assert.match(admin,/event\.shiftKey && \(active === first \|\| !dialog\.contains\(active\)\)/);
// Owner confirmations use usernames, not email-only inputs.
assert.match(html,/id="confirm-account-email" type="text"/);
assert.doesNotMatch(html,/id="confirm-account-email" type="email"/);
assert.match(html,/Type the account username to confirm/);
assert.match(settings,/Enter the exact account username\./);
// Adding an email already verified on another account must fail before sending mail.
assert.match(auth,/SELECT 1 FROM teachers WHERE contact_email=\? AND contact_email_verified_at IS NOT NULL AND suspended=0 AND id<>\? LIMIT 1/);
// Owner deletion cleans dependent rows as well as the account itself.
for(const table of ['lesson_views','auth_challenges','email_tokens','teacher_sessions'])assert.match(users,new RegExp('DELETE FROM '+table),`owner delete cleans ${table}`);
assert.match(users,/accountPaymentStatements\(e\.DB,target\.id\)/);
console.log('PASS: account signup confirmation, dialog focus trap, username confirmations, duplicate email guard and owner-delete cleanup regressions.');
