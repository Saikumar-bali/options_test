const speakeasy = require('speakeasy');

/**
 * Generates a TOTP based on a secret key.
 * @param {string} secret - The base32 encoded TOTP secret.
 * @returns {string} The generated TOTP.
 */
function generateTOTP(secret) {
    if (!secret) {
        throw new Error('TOTP_SECRET is not defined.');
    }
    return speakeasy.totp({
        secret: secret,
        encoding: 'base32',
    });
}

module.exports = {
    generateTOTP,
};