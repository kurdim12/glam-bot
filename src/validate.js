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
    shoot_date: str(body.shoot_date || body.date).slice(0, 40),
    occasion: str(body.occasion || body.type).slice(0, 80),
    location: str(body.location || body.venue).slice(0, 200),
    notes: str(body.notes).slice(0, 2000),
  };

  // Required: name, phone, occasion. Email optional (valid if given).
  if (!value.name) errors.name = 'Please tell us your name.';
  if (!value.phone) errors.phone = 'A phone or WhatsApp number is required.';
  if (!value.occasion) errors.occasion = 'Pick the type of shoot.';
  if (value.email && !EMAIL_RE.test(value.email)) errors.email = 'That email does not look right.';
  // shoot_date is free text now ("Flexible" or a date) — no strict check.

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

module.exports = { validateBooking };
