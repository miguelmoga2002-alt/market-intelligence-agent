"use strict";

/**
 * Tool registry for the LLM agent.
 *
 * Each tool exposes two things:
 *   - `schema`: a typed description the model reads to decide *which* tool to call
 *               and *what* parameters to pass. This is standard function-calling schema.
 *   - `run`:    the deterministic code that actually executes the request. The model
 *               NEVER runs SQL itself; it only returns {tool, params} and this code
 *               owns the query.
 *
 * The whitelists below (VERTICALS, PLATFORMS, ITEM_TYPES, ORDERS) are the security
 * boundary: any value the model proposes is validated against them before it ever
 * reaches the database layer. See ../agent/validate.js.
 *
 * NOTE: this is a portfolio sample. Table/column names are generic and the data is
 * fictional. The real system's scoring logic and data sources are not included.
 */

const VERTICALS = ["pc", "bike", "machinery", "laptop"];
const PLATFORMS = ["market_a", "market_b", "market_c"];
const ITEM_TYPES = ["single_component", "full_build", "accessory", "discard"];
const ORDERS = ["newest", "cheapest", "price_desc"];

const db = require("../db/queries");

/** Build the typed tool schemas that are sent to the model. */
const TOOLS = {
  search_listings: {
    schema: {
      name: "search_listings",
      description:
        "Return marketplace listings matching filters. Use for questions like " +
        "'show me X under 300 newest first'. Does NOT compute prices or medians.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text model name, e.g. 'RTX 4070'." },
          vertical: { type: "string", enum: VERTICALS },
          platform: { type: "string", enum: PLATFORMS },
          max_price: { type: "number", description: "Upper price bound in EUR." },
          order: { type: "string", enum: ORDERS, description: "Sort order. Default 'newest'." },
          limit: { type: "number", description: "Max rows (1-50). Default 20." }
        },
        required: ["query"]
      }
    },
    run: (p) => db.searchListings(p)
  },

  count: {
    schema: {
      name: "count",
      description:
        "Count listings or detected sales matching filters and an optional time window. " +
        "Use for 'how many X sold this month'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          vertical: { type: "string", enum: VERTICALS },
          item_type: { type: "string", enum: ITEM_TYPES },
          status: { type: "string", enum: ["available", "reserved", "sold"] },
          days: { type: "number", description: "Look-back window in days." }
        },
        required: []
      }
    },
    run: (p) => db.count(p)
  },

  median_price: {
    schema: {
      name: "median_price",
      description:
        "Return median / p25 / p75 / min / max price for a model, split by platform. " +
        "Use for 'what's X going for'. Call ONCE PER MODEL when comparing several.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Model name, e.g. 'RTX 4070 Ti'." },
          vertical: { type: "string", enum: VERTICALS },
          item_type: { type: "string", enum: ITEM_TYPES },
          days: { type: "number", description: "Only include listings from the last N days." }
        },
        required: ["query"]
      }
    },
    run: (p) => db.medianPrice(p)
  },

  opportunities: {
    schema: {
      name: "opportunities",
      description:
        "Return pre-scored opportunities (listings flagged as worth acting on). " +
        "Scoring itself runs upstream; this only reads the results.",
      parameters: {
        type: "object",
        properties: {
          vertical: { type: "string", enum: VERTICALS },
          min_margin: { type: "number", description: "Minimum margin filter in EUR." },
          limit: { type: "number" }
        },
        required: []
      }
    },
    run: (p) => db.opportunities(p)
  }
};

module.exports = { TOOLS, VERTICALS, PLATFORMS, ITEM_TYPES, ORDERS };
