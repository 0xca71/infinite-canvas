import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PROXY_TIMEOUT_MS = 300000;
const ALLOWED_API_PREFIXES = ["/v1", "/v1beta", "/api/v3", "/api/plan/v3"];
const FORWARDED_REQUEST_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "api-key",
    "x-api-key",
    "x-goog-api-key",
    "openai-beta",
    "anthropic-beta",
    "anthropic-version",
];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control", "x-request-id"];

type RouteContext = {
    params: Promise<{ target?: string[] }>;
};

export async function OPTIONS(request: NextRequest) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: NextRequest, context: RouteContext) {
    return proxyAiRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
    return proxyAiRequest(request, context);
}

async function proxyAiRequest(request: NextRequest, context: RouteContext) {
    const params = await context.params;
    const [rawTargetBaseUrl, ...targetPathParts] = params.target || [];
    if (!rawTargetBaseUrl) return textResponse(request, "Missing AI proxy target", 400);

    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "POST") return textResponse(request, "Unsupported AI proxy method", 405);

    let targetBaseUrl: URL;
    try {
        targetBaseUrl = new URL(decodeURIComponent(rawTargetBaseUrl));
    } catch {
        return textResponse(request, "Invalid AI proxy target", 400);
    }

    if (targetBaseUrl.protocol !== "http:" && targetBaseUrl.protocol !== "https:") return textResponse(request, "Unsupported AI proxy protocol", 400);
    if (isBlockedHostname(targetBaseUrl.hostname)) return textResponse(request, "AI proxy target is not allowed", 403);
    if (!isAllowedHost(targetBaseUrl.hostname)) return textResponse(request, `AI proxy host is not allowed: ${targetBaseUrl.hostname}`, 403);

    const targetApiPath = `/${targetPathParts.map(encodeURIComponent).join("/")}`;
    if (!isAllowedApiPath(targetApiPath)) return textResponse(request, "Only OpenAI/Gemini compatible API paths are allowed", 403);

    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(targetBaseUrl.toString());
    const basePath = targetUrl.pathname.replace(/\/+$/, "");
    targetUrl.pathname = `${basePath}${targetApiPath}`;
    targetUrl.search = incomingUrl.search;

    const headers = new Headers();
    FORWARDED_REQUEST_HEADERS.forEach((key) => copyHeader(request.headers, headers, key));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_PROXY_TIMEOUT_MS);
    try {
        const body = method === "GET" ? undefined : await request.arrayBuffer();
        const upstream = await fetch(targetUrl, {
            method,
            headers,
            body: body?.byteLength ? body : undefined,
            signal: controller.signal,
        });
        const responseHeaders = responseHeadersFrom(upstream.headers, request);
        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return textResponse(request, "AI proxy timeout", 504);
        return textResponse(request, error instanceof Error ? error.message : "AI proxy error", 502);
    } finally {
        clearTimeout(timer);
    }
}

function corsHeaders(request: NextRequest) {
    const origin = request.headers.get("origin") || "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, api-key, x-api-key, x-goog-api-key, openai-beta, anthropic-beta, anthropic-version",
        Vary: "Origin",
    };
}

function textResponse(request: NextRequest, text: string, status: number) {
    return new Response(text, { status, headers: corsHeaders(request) });
}

function responseHeadersFrom(headers: Headers, request: NextRequest) {
    const result = new Headers(corsHeaders(request));
    FORWARDED_RESPONSE_HEADERS.forEach((key) => copyHeader(headers, result, key));
    return result;
}

function copyHeader(from: Headers, to: Headers, key: string) {
    const value = from.get(key);
    if (value) to.set(key, value);
}

function isAllowedApiPath(path: string) {
    const lowerPath = path.toLowerCase();
    return ALLOWED_API_PREFIXES.some((prefix) => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`));
}

function isAllowedHost(hostname: string) {
    const allowedHosts = (process.env.AI_PROXY_ALLOWED_HOSTS || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    const host = hostname.toLowerCase();
    return !allowedHosts.length || allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function isBlockedHostname(hostname: string) {
    const host = hostname.toLowerCase();
    if (host === "localhost" || host === "metadata.google.internal" || host === "169.254.169.254") return true;
    if (host === "::1" || host === "[::1]") return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
    const private172 = host.match(/^172\.(\d+)\./);
    return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}
