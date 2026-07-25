/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  EVIDENCE: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/evidence" && request.method === "POST") {
      if (!env.EVIDENCE) return Response.json({ error: "Evidence storage is unavailable." }, { status: 503 });
      const contentLength = Number(request.headers.get("content-length") || "0");
      if (contentLength > 10 * 1024 * 1024) {
        return Response.json({ error: "Evidence files must be 10 MB or smaller." }, { status: 413 });
      }
      const form = await request.formData();
      const file = form.get("file");
      const jobId = String(form.get("jobId") || "");
      const provider = String(form.get("provider") || "");
      if (!(file instanceof File) || !/^\d+$/.test(jobId) || !/^0x[a-fA-F0-9]{40}$/.test(provider)) {
        return Response.json({ error: "Invalid evidence upload." }, { status: 400 });
      }
      if (!/^(image|video)\//.test(file.type) && file.type !== "application/pdf") {
        return Response.json({ error: "Upload an image, video or PDF." }, { status: 415 });
      }
      if (file.size > 10 * 1024 * 1024) {
        return Response.json({ error: "Evidence files must be 10 MB or smaller." }, { status: 413 });
      }
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const evidenceHash = `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const key = `job-${jobId}/${crypto.randomUUID()}-${safeName}`;
      await env.EVIDENCE.put(key, bytes, {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
        customMetadata: { jobId, provider: provider.toLowerCase(), evidenceHash },
      });
      const uri = `${url.origin}/api/evidence/${encodeURIComponent(key)}`;
      return Response.json({ key, uri, evidenceHash, name: file.name, size: file.size, type: file.type });
    }

    if (url.pathname.startsWith("/api/evidence/") && request.method === "GET") {
      if (!env.EVIDENCE) return new Response("Evidence storage is unavailable.", { status: 503 });
      const key = decodeURIComponent(url.pathname.slice("/api/evidence/".length));
      const object = await env.EVIDENCE.get(key);
      if (!object) return new Response("Evidence not found.", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "private, max-age=300");
      headers.set("x-content-type-options", "nosniff");
      return new Response(object.body, { headers });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
