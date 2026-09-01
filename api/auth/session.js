const auth = require('../_lib/auth.js');
const { send } = require('../_lib/http.js');

module.exports = async (req, res) => {
  try {
    return send(res, 200, auth.publicSession(req));
  } catch (e) {
    // A missing session secret must not look like a logged-in customer.
    return send(res, 200, { authenticated: false });
  }
};
