import { NextRequest, NextResponse } from "next/server";
import { OgadsOffer, OgadsOffersResponse, RawOgadsOffer } from "@/types/ogads";

const OGADS_API_URL = process.env.OGADS_API_URL ?? "https://lockedapp.org/api/v2";
const OGADS_API_KEY = process.env.OGADS_API_KEY;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes per OGAds best practice

type FormFactor = "mobile" | "desktop";
type MobileOs = "android" | "ios" | "other";

interface CacheEntry {
  expiresAt: number;
  offers: OgadsOffer[];
}

const offerCache = new Map<string, CacheEntry>();

function formatOgadsError(detail: unknown): string {
  if (!detail) {
    return "Unknown OGAds API error";
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail.map((item) => formatOgadsError(item)).join(", ");
  }

  if (typeof detail === "object") {
    const entries = Object.entries(detail as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${formatOgadsError(value)}`);
    if (entries.length > 0) {
      return entries.join(" | ");
    }
  }

  return String(detail);
}

function normalizeDeviceTokens(raw: string[]): string[] {
  return raw.map((value) => value.toLowerCase());
}

function parseFormFactor(value: string | null): FormFactor | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "mobile" || normalized === "desktop") {
    return normalized;
  }
  return undefined;
}

function parseMobileOs(value: string | null): MobileOs | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "android") return "android";
  if (normalized === "ios" || normalized === "iphone" || normalized === "ipad") return "ios";
  return undefined;
}

function detectDeviceFromUserAgent(userAgent: string): { formFactor: FormFactor; mobileOs: MobileOs } {
  const ua = userAgent.toLowerCase();
  const isAndroid = ua.includes("android");
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isMobile = isAndroid || isIos || /mobile|tablet/.test(ua);

  const formFactor: FormFactor = isMobile ? "mobile" : "desktop";
  let mobileOs: MobileOs = "other";
  if (isAndroid) {
    mobileOs = "android";
  } else if (isIos) {
    mobileOs = "ios";
  }

  return { formFactor, mobileOs };
}

function matchesDeviceProfile(offer: OgadsOffer, formFactor: FormFactor, mobileOs: MobileOs): boolean {
  if (offer.devices.length === 0) {
    return true;
  }

  const tokens = normalizeDeviceTokens(offer.devices);

  const includesKeyword = (keywords: string[]) =>
    tokens.some((token) => keywords.some((keyword) => token.includes(keyword)));

  if (formFactor === "desktop") {
    return includesKeyword(["desktop", "pc", "windows", "mac", "macos"]);
  }

  if (mobileOs === "android") {
    if (includesKeyword(["android"])) {
      return true;
    }
    return (
      includesKeyword(["mobile", "smartphone", "tablet"]) && !includesKeyword(["iphone", "ios", "ipad"])
    );
  }

  if (mobileOs === "ios") {
    if (includesKeyword(["iphone", "ios", "ipad", "ipod"])) {
      return true;
    }
    return (
      includesKeyword(["mobile", "smartphone", "tablet"]) && !includesKeyword(["android"])
    );
  }

  return includesKeyword(["mobile", "smartphone", "tablet", "android", "iphone", "ios"]);
}

function normalizeCountryString(country?: string): string[] {
  if (!country) return [];
  return country
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

function matchesOfferType(offer: OgadsOffer, formFactor: FormFactor): boolean {
  if (!offer.type) {
    return true;
  }

  const normalized = offer.type.replace(/[^A-Z]/gi, "").toUpperCase();
  const isCpi = normalized.includes("CPI") || normalized.includes("INSTALL");
  const isCpa = normalized.includes("CPA") || normalized.includes("CPL") || normalized.includes("CPS");

  if (formFactor === "desktop") {
    if (isCpa) return true;
    if (isCpi) return false;
    return true;
  }

  if (isCpi) return true;
  if (isCpa) return false;
  return true;
}

function mapOffer(rawOffer: RawOgadsOffer): OgadsOffer {
  const payout = Number.parseFloat(rawOffer.payout);
  const epc = Number.parseFloat(rawOffer.epc);
  const type = rawOffer.ctype ? rawOffer.ctype.toUpperCase() : null;

  return {
    id: rawOffer.offerid,
    name: rawOffer.name,
    shortName: rawOffer.name_short || rawOffer.name,
    description: rawOffer.description,
    creativeText: rawOffer.adcopy,
    imageUrl: rawOffer.picture,
    payout: Number.isFinite(payout) ? payout : 0,
    countryCodes: normalizeCountryString(rawOffer.country),
    devices: rawOffer.device
      .split(",")
      .map((device) => device.trim())
      .filter(Boolean),
    trackingUrl: rawOffer.link,
    epc: Number.isFinite(epc) ? epc : null,
    type,
  };
}

function isLoopbackOrLocal(ip: string): boolean {
  const value = ip.trim();
  if (!value) return true;
  if (value === "::1" || value === "127.0.0.1") {
    return true;
  }

  if (value.startsWith("::ffff:127.")) {
    return true;
  }

  if (value.startsWith("192.168.")) {
    return true;
  }

  if (value.startsWith("10.")) {
    return true;
  }

  if (value.startsWith("172.")) {
    const secondOctet = Number.parseInt(value.split(".")[1] ?? "", 10);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  if (value.toLowerCase().startsWith("fe80")) {
    return true;
  }

  return false;
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip && !isLoopbackOrLocal(ip)) return ip;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed && !isLoopbackOrLocal(trimmed)) {
      return trimmed;
    }
  }

  const requestIp = (request as unknown as { ip?: string }).ip;
  if (typeof requestIp === "string" && requestIp.length > 0 && !isLoopbackOrLocal(requestIp)) {
    return requestIp;
  }

  return null;
}

function getCacheKey(country: string | null, formFactor: FormFactor, mobileOs: MobileOs) {
  return [country ?? "ALL", formFactor, mobileOs].join("|");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const userAgentParam = searchParams.get("userAgent") ?? undefined;
  const countryFilter = searchParams.get("country")?.toUpperCase() ?? null;
  const userAgentHeader = request.headers.get("user-agent") || undefined;
  const resolvedUserAgent = userAgentParam || userAgentHeader || "OgadsNextApp/1.0";

  const detectedDefaults = detectDeviceFromUserAgent(resolvedUserAgent);
  const formFactor = parseFormFactor(searchParams.get("formFactor")) ?? detectedDefaults.formFactor;
  const mobileOs = parseMobileOs(searchParams.get("os")) ?? detectedDefaults.mobileOs;

  const clientIp = getClientIp(request) ?? searchParams.get("ip");

  if (!OGADS_API_KEY) {
    return NextResponse.json(
      { error: "OGADS_API_KEY is not configured" },
      { status: 500 }
    );
  }

  if (!clientIp) {
    return NextResponse.json(
      { error: "Unable to determine client IP address" },
      { status: 400 }
    );
  }

  const cacheKey = getCacheKey(countryFilter, formFactor, mobileOs);
  const cachedEntry = offerCache.get(cacheKey);
  const now = Date.now();
  if (cachedEntry && cachedEntry.expiresAt > now) {
    return NextResponse.json({ offers: cachedEntry.offers });
  }

  const requestUrl = new URL(OGADS_API_URL);
  requestUrl.searchParams.set("ip", clientIp);
  requestUrl.searchParams.set("user_agent", resolvedUserAgent);
  requestUrl.searchParams.set("ctype", "0");

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${OGADS_API_KEY}`,
      },
      cache: "no-store",
    });

    const rawBody = await response.text();
    let payload: OgadsOffersResponse | null = null;
    try {
      payload = JSON.parse(rawBody) as OgadsOffersResponse;
    } catch (parseError) {
      console.error("Failed to parse OGAds response", parseError);
    }

    if (!response.ok || !payload || !payload.success) {
      const status = response.status >= 400 ? response.status : 502;
      const errorMessage = payload
        ? formatOgadsError(payload.error)
        : `OGAds API responded with status ${response.status}`;
      return NextResponse.json({ error: errorMessage }, { status });
    }

    const offers = payload.offers
      .map(mapOffer)
      .filter((offer) => {
        if (!countryFilter) return true;
        return (
          offer.countryCodes.length === 0 || offer.countryCodes.includes(countryFilter)
        );
      })
      .filter((offer) => matchesOfferType(offer, formFactor))
      .filter((offer) => matchesDeviceProfile(offer, formFactor, mobileOs))
      .sort((a, b) => {
        const epcA = Number.isFinite(a.epc) && a.epc !== null ? a.epc : -1;
        const epcB = Number.isFinite(b.epc) && b.epc !== null ? b.epc : -1;

        if (epcA !== epcB) {
          return epcB - epcA;
        }

        return b.payout - a.payout;
      });

    offerCache.set(cacheKey, {
      offers,
      expiresAt: now + CACHE_TTL_MS,
    });

    return NextResponse.json({ offers });
  } catch (error) {
    console.error("Failed to fetch OGAds offers", error);
    return NextResponse.json(
      { error: "Failed to fetch offers" },
      { status: 500 }
    );
  }
}
