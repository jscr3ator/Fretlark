import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const admin=readFileSync('public/admin.js','utf8');
const html=readFileSync('public/admin.html','utf8');
const settings=readFileSync('public/account-settings.js','utf8');
const auth=readFileSync('lib/teacher-auth.mjs','utf8');
const users=readFileSync('lib/user-management.mjs','utf8');
const mail=readFileSync('lib/mail.mjs','utf8');
const migration=readFileSync('drizzle/0010_one_account_per_email.sql','utf8');
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
// One account per email: confirmed, pending (<24 h) and old-username holders are all refused.
assert.match(auth,/async function emailConflict/);
assert.match(auth,/SELECT id FROM teachers WHERE lower\(contact_email\)=\? AND contact_email_verified_at IS NOT NULL AND id<>\? LIMIT 1/);
assert.match(auth,/created_at>\? AND id<>\? LIMIT 1/);
assert.match(auth,/lower\(trim\(email\)\)=\?/);
assert.match(auth,/PENDING_SIGNUP_MS/);
// The unique lower(contact_email) guard and deletion-code table live in the new migration.
assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS teachers_contact_email_unique ON teachers \(lower\(contact_email\)\) WHERE contact_email IS NOT NULL/);
assert.match(migration,/CREATE TABLE IF NOT EXISTS account_delete_codes/);
// Deleting an account with a confirmed email needs an emailed, single-use code.
assert.match(auth,/delete-account-code/);
assert.match(auth,/account_delete_codes/);
assert.match(auth,/DELETE_CODE_ATTEMPTS/);
assert.match(mail,/export function deleteCodeMessage/);
if(!mail.includes('not part of the open-source build')){
 assert.match(mail,/heading: 'Confirm account deletion'/);
 assert.match(mail,/font-size:36px/);
}
assert.match(settings,/auth\/delete-account-code/);
assert.match(settings,/delete-account-verify-code/);
assert.match(settings,/We sent a 6-digit code to/);
assert.match(settings,/Delete account permanently/);
assert.match(settings,/delete-account-resend/);
assert.match(html,/id="delete-account-verify-code"/);
assert.match(html,/id="delete-account-resend"/);
// Owner deletion cleans dependent rows as well as the account itself.
for(const table of ['lesson_views','auth_challenges','email_tokens','account_delete_codes','teacher_sessions'])assert.match(users,new RegExp('DELETE FROM '+table),`owner delete cleans ${table}`);
assert.match(users,/accountPaymentStatements\(e\.DB,target\.id\)/);
console.log('PASS: account signup confirmation, dialog focus trap, username confirmations, duplicate email guard, deletion codes and owner-delete cleanup regressions.');
