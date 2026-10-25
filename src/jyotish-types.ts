/** Plain RPC facts. Signs are zero-based (0=Aries); houses, nakshatras and padas are one-based. */
import type { BirthProfile } from './ephemeris.js';

export type GrahaName = 'sun' | 'moon' | 'mars' | 'mercury' | 'jupiter' | 'venus' | 'saturn' | 'rahu' | 'ketu';
export type ReferenceBody = 'uranus' | 'neptune' | 'pluto';
export interface JyotishSkyRequest {
  profile: BirthProfile;
  timezone: string;
  today: string;
  scope: 'now' | 'lifetime';
  residence?: { latitude: number; longitude: number };
  /** Default 365.25. A fixed-day convention, independent of civil anniversaries. */
  dashaYearDays?: number;
}
export interface Nakshatra {
  index: number;
  name: string;
  pada: number;
  lord: GrahaName;
  fraction: number;
}
export type JyotishDignity = 'exaltation' | 'debilitation' | 'moolatrikona' | 'own-sign';
export interface JyotishPosition {
  body: GrahaName;
  longitude: number;
  latitude: number;
  speed: number;
  sign: number;
  /** Lagna houses are absent without a known birth time. */
  house?: number;
  moonHouse: number;
  retrograde: boolean;
}
export interface JyotishGraha extends JyotishPosition {
  combust: boolean;
  dignity: JyotishDignity | null;
  nakshatra: Nakshatra;
  navamsaSign: number;
}
export interface JyotishNatal {
  timeKnown: boolean;
  instant: string | null;
  /** Local noon is only an approximate representative when the birth time is unknown. */
  representative: string;
  ayanamsa: number;
  grahas: JyotishGraha[];
  outer: { body: ReferenceBody; longitude: number; latitude: number; speed: number; sign: number; retrograde: boolean }[];
  lagna?: { longitude: number; sign: number; nakshatra: Nakshatra; navamsaSign: number };
  moonSign: number;
  moonSignCandidates: number[];
  moonRange?: [number, number];
}
export interface DashaPeriod {
  level: 1 | 2 | 3;
  lord: GrahaName;
  mahaLord: GrahaName;
  antarLord?: GrahaName;
  start: string;
  end: string;
}
export interface DashaBalance {
  lord: GrahaName;
  nakshatra: number;
  elapsedFraction: number;
  remainingYears: number;
  start: string;
  end: string;
}
export interface DashaSchedule {
  yearDays: number;
  birthBalance: DashaBalance;
  maha: DashaPeriod[];
  antar: DashaPeriod[];
  /** Empty for the full lifetime; the current third-level period is still supplied. */
  pratyantar: DashaPeriod[];
  current: { maha: DashaPeriod | null; antar: DashaPeriod | null; pratyantar: DashaPeriod | null };
}
export interface DashaUncertainty {
  birthWindow: { start: string; end: string };
  /** Endpoint envelopes, not a guarantee that all intermediate births share the same lord. */
  mahaStartRange: [string, string];
  mahaEndRange: [string, string];
  startingLords: GrahaName[];
  alternatives: { birthInstant: string; moonLongitude: number; moonSign: number; schedule: DashaSchedule }[];
}
export interface JyotishIngress {
  body: GrahaName;
  at: string;
  sign: number;
  house?: number;
  moonHouse: number;
  retrograde: boolean;
}
export interface SaturnPeriod {
  start: string;
  end: string;
  sign: number;
  moonHouse: number;
  kind: 'sade-sati' | 'ashtama-shani';
  phase?: 'rising' | 'peak' | 'setting';
}
export interface JyotishLunation {
  at: string;
  kind: 'new' | 'full';
  longitude: number;
  sign: number;
  house?: number;
  moonHouse: number;
  eclipse: 'solar' | 'lunar' | null;
  eclipseType?: number;
}
export interface JyotishSky {
  calculationVersion: string;
  zodiac: 'sidereal-lahiri';
  ayanamsa: 'lahiri';
  node: 'mean';
  scope: 'now' | 'lifetime';
  approximate: boolean;
  window: { start: string; end: string };
  natal: JyotishNatal;
  dasha: DashaSchedule & { uncertainty?: DashaUncertainty };
  gochara: {
    approximate: boolean;
    /** Positions of all nine grahas at the reader's local noon today. */
    positions: JyotishPosition[];
    ingresses: JyotishIngress[];
    saturnPeriods: SaturnPeriod[];
    jupiterPeriods: { start: string; end: string; sign: number; moonHouse: number }[];
    returns: { body: 'jupiter' | 'saturn'; at: string; longitude: number; approximate: boolean }[];
  };
  /** Now: new/full moons and matched eclipses. Lifetime: empty (slow timing only). */
  lunations: JyotishLunation[];
}
