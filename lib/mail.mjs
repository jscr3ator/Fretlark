// Email is not part of the open-source build.
const fail = (message, status = 503) => Object.assign(new Error(message), {status});
export const mailConfigured = () => false;
export function sendMail() {
 throw fail('Email sending is not configured on this server.');
}
export function verifyEmailMessage() { return {}; }
export function resetPasswordMessage() { return {}; }
