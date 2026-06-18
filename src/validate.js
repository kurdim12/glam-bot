'use strict';

/** Server-side validation for the public booking form. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate + normalise an incoming booking payload.
 * Returns { ok: true, value } or { ok: false, errors }.
 */
function validateBooking(body) {
  const errors = {};
  const value = {
    name: str(body.name).slice(0, 120),
    email: str(body.email).slice(0, 200),
    phone: str(body.phone).slice(0, 40),
    shoot_date: str(body.shoot_date || body.date).slice(0, 20),
    occasion: str(body.occasion || body.type).slice(0, 80),
    location: str(body.location || body.venue).slice(0, 200),
    notes: str(body.notes).slice(0, 2000),
  };

  if (!value.name) errors.name = 'Please tell us your name.';
  if (!value.email) errors.email = 'An email is required.';
  else if (!EMAIL_RE.test(value.email)) errors.email = 'That email does not look right.';
  if (!value.phone) errors.phone = 'A phone or WhatsApp number is required.';

  if (value.shoot_date) {
    const d = new Date(value.shoot_date);
    if (Number.isNaN(d.getTime())) {
      errors.shoot_date = 'Invalid date.';
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

module.exports = { validateBooking };
