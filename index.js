import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || "";

// Simple health check so you can confirm the server is alive in a browser
app.get("/", (req, res) => {
  res.send("Pollinations MCP server is running. MCP endpoint is /mcp");
});

// Describe the one tool this server exposes: generate_image
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
  let url = `https://gen.pollinations.ai/image/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;
  if (seed !== undefined) url += `&seed=${seed}`;

  const headers = {};
  if (POLLINATIONS_API_KEY) {
    headers["Authorization"] = `Bearer ${POLLINATIONS_API_KEY}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Pollinations API error: ${response.status} ${response.statusText}`);
  }

  // The image bytes come back directly; we re-expose the same URL as the result
  // (Claude can fetch this URL to display/download the image)
  return {
    content: [
      {
        type: "text",
        text: `Image generated successfully. URL: ${url}`,
      },
    ],
  };
}

// Main MCP JSON-RPC endpoint
app.post("/mcp", async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  try {
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "pollinations-mcp-server", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      if (name === "generate_image") {
        const result = await generateImage(args);
        return res.json({ jsonrpc: "2.0", id, result });
      }
      return res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
    }

    // Notifications (no id expected) - just acknowledge
    if (method === "notifications/initialized") {
      return res.status(202).end();
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (err) {
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err.message },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Pollinations MCP server listening on port ${PORT}`);
});
