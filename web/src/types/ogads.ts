export interface RawOgadsOffer {
  offerid: number;
  name: string;
  name_short: string;
  description: string;
  adcopy: string;
  picture: string;
  payout: string;
  country: string;
  device: string;
  link: string;
  epc: string;
  boosted?: boolean;
  ctype?: string;
  cvr?: string;
}

export interface OgadsOffersResponse {
  success: boolean;
  error: string | null;
  offers: RawOgadsOffer[];
}

export interface OgadsOffer {
  id: number;
  name: string;
  shortName: string;
  description: string;
  creativeText: string;
  imageUrl: string;
  payout: number;
  countryCodes: string[];
  devices: string[];
  trackingUrl: string;
  epc: number | null;
  type: string | null;
}
