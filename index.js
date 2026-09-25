import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || "";

// Track sessions (in-memory; fine for a single Render instance)
const sessions = new Set();

app.get("/", (req, res) => {
  res.send("Pollinations MCP server is running. MCP endpoint is /mcp");
});

const TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate an image from a text prompt using Pollinations.ai. Returns a public image URL.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the image to generate",
        },
        width: {
          type: "integer",
          description: "Image width in pixels (default 1024)",
        },
        height: {
          type: "integer",
          description: "Image height in pixels (default 1024)",
        },
        seed: {
          type: "integer",
          description: "Optional seed for reproducible results",
        },
      },
      required: ["prompt"],
    },
  },
];

async function generateImage({ prompt, width = 1024, height = 1024, seed }) {
  const encodedPrompt = encodeURIComponent(prompt);
  // FIX: correct Pollinations domain + path is image.pollinations.ai/prompt/...
  let url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;
  if (seed !== undefined) url += `&seed=${seed}`;

  const headers = {};
  if (POLLINATIONS_API_KEY) {
    headers["Authorization"] = `Bearer ${POLLINATIONS_API_KEY}`;
  }

  console.log(`[generate_image] fetching: ${url}`);
  const response = await fetch(url, { headers });
  console.log(`[generate_image] status: ${response.status}`);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Pollinations API error: ${response.status} ${response.statusText} ${bodyText.slice(0, 200)}`
    );
  }

  return {
    content: [
      {
        type: "text",
        text: `Image generated successfully. URL: ${url}`,
      },
    ],
  };
}

app.post("/mcp", async (req, res) => {
  // Log every incoming request so Render logs show request-time activity
  console.log(`[mcp] method=${req.body?.method} session=${req.headers["mcp-session-id"] || "none"}`);

  // Always respond as JSON (not SSE) — simplest transport Claude's client accepts
  res.setHeader("Content-Type", "application/json");

  const { id, method, params } = req.body || {};

  try {
    if (method === "initialize") {
      const sessionId = randomUUID();
      sessions.add(sessionId);
      res.setHeader("Mcp-Session-Id", sessionId);
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "pollinations-mcp-server", version: "1.0.1" },
        },
      });
    }

    if (method === "notifications/initialized") {
      return res.status(202).end();
    }

    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      if (name === "generate_image") {
        try {
          const result = await generateImage(args || {});
          return res.json({ jsonrpc: "2.0", id, result });
        } catch (err) {
          console.error(`[generate_image] failed: ${err.message}`);
          // Return as a TOOL result error (isError), not a JSON-RPC error.
          // This is what lets Claude show the actual failure reason instead of a generic one.
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Image generation failed: ${err.message}` }],
              isError: true,
            },
          });
        }
      }
      return res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (err) {
    console.error(`[mcp] unhandled error: ${err.stack || err.message}`);
    return res.status(200).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err.message },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Pollinations MCP server listening on port ${PORT}`);
});
