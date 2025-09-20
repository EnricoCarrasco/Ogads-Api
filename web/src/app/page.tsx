"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import type { OgadsOffer } from "@/types/ogads";

type FetchState = "idle" | "loading" | "error";

type FormFactor = "mobile" | "desktop";
type MobileOs = "android" | "ios" | "other";

interface DeviceProfile {
  formFactor: FormFactor;
  os: MobileOs;
}

interface LocationInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
}

interface OffersApiSuccess {
  offers: OgadsOffer[];
}

interface OffersApiError {
  error: string;
}

const FALLBACK_IMAGE = "/offer-placeholder.svg";

export default function HomePage() {
  const [offers, setOffers] = useState<OgadsOffer[]>([]);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [status, setStatus] = useState<FetchState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => {
    void hydrateOffers();
  }, []);

  async function hydrateOffers() {
    setStatus("loading");
    setError(null);

    try {
      const locationInfo = await resolveLocation();
      setLocation(locationInfo);

      const detectedDevice = detectDeviceProfile();
      setDeviceProfile(detectedDevice);

      const offersPayload = await fetchOffersForLocation(locationInfo);
      setOffers(offersPayload.offers);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong while loading offers.");
      }
    }
  }

  const heading = useMemo(() => {
    if (!location) {
      return "OGAds Offers Near You";
    }

    const regionPart = location.region ? ", " + location.region : "";
    return "Offers available in " + location.city + regionPart + ", " + location.country;
  }, [location]);

  const offerTypeLabel = useMemo(() => {
    if (!deviceProfile) return "OGAds offers";
    if (deviceProfile.formFactor === "desktop") {
      return "desktop CPA offers";
    }
    if (deviceProfile.os === "android") {
      return "Android CPI offers";
    }
    if (deviceProfile.os === "ios") {
      return "iOS CPI offers";
    }
    return "mobile CPI offers";
  }, [deviceProfile]);

  const feedBadge = deviceProfile?.formFactor === "desktop" ? "Desktop CPA" : "Mobile CPI";
  const feedSourceLabel = "OGAds ctype=0 (server filtered)";
  const hasOffers = offers.length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} />
      <main className={styles.container}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Serving {offerTypeLabel}</p>
            <h1 className={styles.title}>{heading}</h1>
            <p className={styles.subtitle}>
              We automatically detect your approximate location and device so you only see offers that
              match both your country and platform.
            </p>
          </div>
          <div className={styles.headerMeta}>
            {location ? (
              <div className={styles.locationCard}>
                <span className={styles.locationLabel}>Detected location</span>
                <span className={styles.locationValue}>
                  {location.city}, {location.region ? location.region + ", " : ""}
                  {location.country}
                </span>
                <span className={styles.locationIp}>IP: {location.ip}</span>
              </div>
            ) : (
              <div className={styles.locationFallback}>Detecting your location…</div>
            )}
            {deviceProfile ? (
              <div className={styles.locationCard}>
                <span className={styles.locationLabel}>Detected device</span>
                <span className={styles.locationValue}>
                  {deviceProfile.formFactor === "desktop"
                    ? "Desktop browser"
                    : deviceProfile.os === "android"
                      ? "Android device"
                      : deviceProfile.os === "ios"
                        ? "iOS device"
                        : "Mobile device"}
                </span>
                <span className={styles.deviceMeta}>
                  {feedBadge} • {feedSourceLabel}
                </span>
              </div>
            ) : null}
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => {
                void hydrateOffers();
              }}
              disabled={status === "loading"}
            >
              {status === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {status === "error" ? (
          <section className={styles.stateCard}>
            <p className={styles.stateTitle}>We could not load offers right now.</p>
            <p className={styles.stateDescription}>{error ?? "Please try again in a moment."}</p>
          </section>
        ) : null}

        {status === "loading" && !hasOffers ? (
          <section className={styles.stateCard}>
            <p className={styles.stateTitle}>Fetching offers for you…</p>
            <p className={styles.stateDescription}>
              Hang tight while we contact OGAds and tailor the feed to your area.
            </p>
          </section>
        ) : null}

        {hasOffers ? (
          <section className={styles.offersSection}>
            <div className={styles.offersHeader}>
              <h2>Top {offerTypeLabel}</h2>
              <p>
                Filtered via OGAds by IP and user agent. We request OGAds with ctype=0 once and filter the
                response server-side so that only campaigns relevant to your current device remain.
              </p>
            </div>
            <div className={styles.offerGrid}>
              {offers.map((offer) => (
                <article key={offer.id} className={styles.offerCard}>
                  <OfferHero imageUrl={offer.imageUrl} name={offer.shortName} />
                  <div className={styles.offerBody}>
                    <h3>{offer.name}</h3>
                    <p className={styles.offerDescription}>{sanitizeHtml(offer.description)}</p>
                    <dl className={styles.metaList}>
                      <div>
                        <dt>Offer type</dt>
                        <dd>{offer.type ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt>Payout</dt>
                        <dd>{formatCurrency(offer.payout)}</dd>
                      </div>
                      <div>
                        <dt>Devices</dt>
                        <dd>{offer.devices.join(", ") || "All"}</dd>
                      </div>
                      <div>
                        <dt>Target countries</dt>
                        <dd>{offer.countryCodes.join(", ") || "Global"}</dd>
                      </div>
                      {offer.epc !== null ? (
                        <div>
                          <dt>EPC</dt>
                          <dd>{offer.epc.toFixed(5)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                  <footer className={styles.offerFooter}>
                    <a href={offer.trackingUrl} target="_blank" rel="noopener noreferrer" className={styles.offerButton}>
                      Get tracking link
                    </a>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {status === "idle" && !hasOffers ? (
          <section className={styles.stateCard}>
            <p className={styles.stateTitle}>No offers matched your location yet.</p>
            <p className={styles.stateDescription}>
              Double-check that your IP is eligible for OGAds CPI campaigns or try refreshing.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}

async function resolveLocation(): Promise<LocationInfo> {
  const response = await fetch("https://ipapi.co/json/");
  if (!response.ok) {
    throw new Error("Unable to determine your location.");
  }
  const data = (await response.json()) as Record<string, string>;

  return {
    ip: data.ip,
    city: data.city || "Unknown city",
    region: data.region || "",
    country: data.country_name || data.country || "Unknown country",
    countryCode: (data.country_code || data.country || "").toUpperCase(),
  };
}

async function fetchOffersForLocation(location: LocationInfo): Promise<OffersApiSuccess> {
  const params = new URLSearchParams();
  params.set("ip", location.ip);
  if (location.countryCode) {
    params.set("country", location.countryCode);
  }

  const response = await fetch("/api/offers?" + params.toString());
  const payload = (await response.json()) as OffersApiSuccess | OffersApiError;

  if (!response.ok) {
    throw new Error("OGAds request failed: " + ("error" in payload && payload.error ? payload.error : "Unexpected error"));
  }

  if (!("offers" in payload)) {
    throw new Error("Malformed response from offers API.");
  }

  return payload;
}

function detectDeviceProfile(): DeviceProfile {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const lowerUa = userAgent.toLowerCase();

  const isAndroid = lowerUa.includes("android");
  const isIos = /iphone|ipad|ipod/.test(lowerUa);
  const isMobile = isAndroid || isIos || /mobile|tablet/.test(lowerUa);

  const formFactor: FormFactor = isMobile ? "mobile" : "desktop";
  let os: MobileOs = "other";
  if (isAndroid) {
    os = "android";
  } else if (isIos) {
    os = "ios";
  }

  return {
    formFactor,
    os,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function sanitizeHtml(value: string) {
  const tmp = document.createElement("div");
  tmp.innerHTML = value;
  return tmp.textContent || tmp.innerText || "";
}

interface OfferHeroProps {
  imageUrl: string;
  name: string;
}

function OfferHero({ imageUrl, name }: OfferHeroProps) {
  const [src, setSrc] = useState<string>(imageUrl || FALLBACK_IMAGE);

  useEffect(() => {
    setSrc(imageUrl || FALLBACK_IMAGE);
  }, [imageUrl]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.offerImage}
      src={src}
      alt={name}
      onError={() => {
        setSrc(FALLBACK_IMAGE);
      }}
    />
  );
}
