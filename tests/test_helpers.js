const jwt = require("jsonwebtoken");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_1234567890";

function createToken(payload = { id: 1, role: "admin" }, options = { expiresIn: "1h" }) {
  return jwt.sign(payload, process.env.JWT_SECRET, options);
}

function startTestServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

function validApplicationPayload(overrides = {}) {
  return {
    first_name: "Kwame",
    middle_name: "Kofi",
    last_name: "Mensah",
    date_of_birth: "2015-05-12",
    gender: "Male",
    email: "kwame.mensah@example.com",
    phone: "0241234567",
    address: "123 Independence Avenue, Accra",
    class_applied_for: "Basic 1",
    guardian: {
      full_name: "Ama Mensah",
      relationship: "Mother",
      phone_number: "0247654321",
      email: "ama.mensah@example.com",
      address: "123 Independence Avenue, Accra",
    },
    ...overrides,
  };
}

module.exports = {
  createToken,
  startTestServer,
  validApplicationPayload,
};
