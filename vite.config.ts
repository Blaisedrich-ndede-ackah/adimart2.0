import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const devApiModules: Record<string, string> = {
  "/api/manage-promotional-campaigns": "api/manage-promotional-campaigns.ts",
  "/api/shop-auth": "api/shop-auth.ts",
  "/api/shop-wallet": "api/shop-wallet.ts",
  "/api/shop-checkout": "api/shop-checkout.ts",
  "/api/shop-owner": "api/shop-owner.ts",
  "/api/paystack-webhook": "api/paystack-webhook.ts",
  "/api/paystack-return": "api/paystack-return.ts",
};

function promotionalCampaignDevApi(): Plugin {
  return {
    name: "adimat-promotional-campaign-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url || !devApiModules[url]) {
          next();
          return;
        }
        void handleCampaignApi(server, req, res, devApiModules[url]);
      });
    },
  };
}

async function handleCampaignApi(
  server: import("vite").ViteDevServer,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  modulePath = "api/manage-promotional-campaigns.ts",
): Promise<void> {
  if (req.method !== "POST" && req.method !== "GET") {
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
      body = raw;
    }
  }

  try {
    const loaded = await server.ssrLoadModule(
      path.resolve(__dirname, modulePath),
    ) as { default: (request: {
      method?: string;
      url?: string;
      body?: unknown;
      rawBody?: string;
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
        res.statusCode = status;
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
      end(payload?: string) {
        res.statusCode = statusCode;
        if (!res.writableEnded) res.end(payload);
      },
    };
    await loaded.default(
      { method: req.method, url: req.url, body, rawBody: raw, headers: req.headers, socket: req.socket },
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
    plugins: [react(), tailwindcss(), viteSingleFile(), promotionalCampaignDevApi()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
