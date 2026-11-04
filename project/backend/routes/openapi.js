const express = require("express");
const router = express.Router();
const { getOpenApiSpec } = require("../controllers/openapiController");

// Public — no protect. Describes the API, exposes no data.
router.get("/", getOpenApiSpec);

module.exports = router;
