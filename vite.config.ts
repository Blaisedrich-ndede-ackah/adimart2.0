import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function promotionalCampaignDevApi(): Plugin {
  return {
    name: "adimat-promotional-campaign-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url === "/api/customer-care") {
          void handleLocalApi(server, req, res, "api/customer-care.ts");
          return;
        }
        if (url !== "/api/manage-promotional-campaigns") {
          next();
          return;
        }
        void handleLocalApi(server, req, res, "api/manage-promotional-campaigns.ts");
      });
    },
  };
}

async function handleLocalApi(
  server: import("vite").ViteDevServer,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  modulePath: string,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : "Could not read the request.",
    }));
    return;
  }
  let body: unknown = {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "A JSON object is required." }));
      return;
    }
  }
  try {
    const loaded = await server.ssrLoadModule(path.resolve(__dirname, modulePath)) as {
      default: (request: {
        method?: string;
        body?: unknown;
        headers: import("node:http").IncomingMessage["headers"];
        socket?: { remoteAddress?: string };
      }, response: {
        status: (status: number) => { json: (payload: unknown) => void };
        json: (payload: unknown) => void;
        setHeader: (name: string, value: string) => void;
      }) => Promise<void>;
    };
    let statusCode = 200;
    const response = {
      status(status: number) {
        statusCode = status;
        return response;
      },
      setHeader(name: string, value: string) {
        res.setHeader(name, value);
      },
      json(payload: unknown) {
        res.statusCode = statusCode;
        if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      },
    };
    await loaded.default(
      { method: req.method, body, headers: req.headers, socket: req.socket },
      response,
    );
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Request failed." }));
    }
  } catch (error) {
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : "Request failed.",
      }));
    }
  }
}

async function handleCampaignApi(
  server: import("vite").ViteDevServer,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const chunks: Buffer[] = [];
  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : "Could not read the campaign request.",
    }));
    return;
  }

  let body: unknown = {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "A JSON object is required." }));
      return;
    }
  }

  try {
    const loaded = await server.ssrLoadModule(
      path.resolve(__dirname, "api/manage-promotional-campaigns.ts"),
    ) as { default: (request: {
      method?: string;
      body?: unknown;
      headers: import("node:http").IncomingMessage["headers"];
      socket?: { remoteAddress?: string };
    }, response: {
      status: (status: number) => { json: (payload: unknown) => void };
      json: (payload: unknown) => void;
      setHeader: (name: string, value: string) => void;
    }) => Promise<void> };
    let statusCode = 200;
    const response = {
      status(status: number) {
        statusCode = status;
        return response;
      },
      setHeader(name: string, value: string) {
        res.setHeader(name, value);
      },
      json(payload: unknown) {
        res.statusCode = statusCode;
        if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      },
    };
    await loaded.default(
      { method: req.method, body, headers: req.headers, socket: req.socket },
      response,
    );
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Campaign request failed." }));
    }
  } catch (error) {
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : "Campaign request failed.",
      }));
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, __dirname, "");
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    build: {
      // es2022 matches current Chrome, Edge, Firefox, Safari, Samsung Internet, and Opera.
      // esbuild cannot downlevel destructuring for the older safari14 target.
      target: "es2022",
    },
    plugins: [react(), tailwindcss(), viteSingleFile(), promotionalCampaignDevApi()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
