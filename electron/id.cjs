const { randomUUID } = require('node:crypto');

function createId(prefix) {
  return `${String(prefix || 'id')}-${randomUUID()}`;
}

module.exports = { createId };
