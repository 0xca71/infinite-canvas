import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PROXY_TIMEOUT_MS = 300000;
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function resolveProxyTarget(target: string): string {
    const gateway = process.env.DOCKER_HOST_GATEWAY;
    if (!gateway) return target;
    try {
        const url = new URL(target);
        if (LOCAL_HOSTNAMES.has(url.hostname)) {
            url.hostname = gateway;
            return url.toString();
        }
    } catch {
        // invalid URL, return as-is
    }
    return target;
}

async function proxyRequest(request: NextRequest, method: string) {
    const rawTarget = request.headers.get("x-ai-proxy-target") || request.nextUrl.searchParams.get("target") || "";
    const target = resolveProxyTarget(rawTarget);
    const auth = request.headers.get("x-ai-proxy-auth") || "";
    const apiKey = request.headers.get("x-ai-proxy-api-key") || "";
    if (!target) return new Response("Missing x-ai-proxy-target", { status: 400 });

    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return new Response("Invalid x-ai-proxy-target", { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return new Response("Unsupported target protocol", { status: 400 });
    }

    const headers = new Headers();
    if (auth) headers.set("Authorization", auth);
    if (apiKey) headers.set("x-goog-api-key", apiKey);
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const accept = request.headers.get("accept");
    if (accept) headers.set("Accept", accept);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_PROXY_TIMEOUT_MS);
    try {
        const body = method === "GET" || method === "HEAD" || method === "DELETE" ? undefined : await request.arrayBuffer();
        const response = await fetch(url, {
            method,
            headers,
            body: body?.byteLength ? body : undefined,
            signal: controller.signal,
            redirect: "manual",
        });
        const responseText = await response.text();
        const forwardedHeaders = new Headers();
        forwardedHeaders.set("Content-Type", response.headers.get("content-type") || "application/json");
        return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: forwardedHeaders,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return new Response("AI proxy timeout", { status: 504 });
        return new Response(error instanceof Error ? error.message : "AI proxy error", { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

export async function GET(request: NextRequest) {
    return proxyRequest(request, "GET");
}

export async function POST(request: NextRequest) {
    return proxyRequest(request, "POST");
}

export async function DELETE(request: NextRequest) {
    return proxyRequest(request, "DELETE");
}
