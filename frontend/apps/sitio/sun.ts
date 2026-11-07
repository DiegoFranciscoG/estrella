/**
 * Position of the sun, sunrise and sunset: the NOAA Global Monitoring Laboratory equations
 * (https://gml.noaa.gov/grad/solcalc/calcdetails.html), which follow Jean Meeus, "Astronomical
 * Algorithms". Accurate to about a minute for sunrise and sunset and a fraction of a degree for
 * the sun's position between 1901 and 2099, far finer than a site study needs.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const mod = (a: number, b: number) => ((a % b) + b) % b;

export function julianDay(ms: number): number {
  return ms / 86_400_000 + 2_440_587.5;
}

interface Orbit { declination: number; equationOfTime: number }

/** Declination (degrees) and equation of time (minutes) at an instant. */
function orbit(ms: number): Orbit {
  const t = (julianDay(ms) - 2_451_545) / 36_525;
  const l0 = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const equationOfTime = 4 * DEG * (
    y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD) + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD)
  );
  return { declination, equationOfTime };
}

/** Atmospheric refraction near the horizon (NOAA's approximation), degrees. */
function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let arcsec: number;
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575) arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

export interface SunPosition {
  /** Degrees above the horizon (with refraction): negative at night. */
  altitude: number;
  /** Degrees clockwise from true north: 90 east, 180 south, 270 west. */
  azimuth: number;
  declination: number;
  equationOfTime: number;
}

/** Where the sun is at an instant (UTC milliseconds), seen from latitude/longitude in degrees. */
export function sunPosition(ms: number, lat: number, lon: number): SunPosition {
  const { declination, equationOfTime } = orbit(ms);
  const minutes = mod(ms / 60_000, 1440);
  const trueSolar = mod(minutes + equationOfTime + 4 * lon, 1440);
  const hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(declination * RAD) + Math.cos(lat * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
  const elevation = 90 - zenith;
  const denominator = Math.cos(lat * RAD) * Math.sin(zenith * RAD);
  let azimuth: number;
  if (Math.abs(denominator) < 1e-12) {
    azimuth = lat > 0 ? 180 : 0; // Sun at the zenith or observer at a pole: any azimuth is right.
  } else {
    const a = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat * RAD) * Math.cos(zenith * RAD) - Math.sin(declination * RAD)) / denominator))) * DEG;
    azimuth = hourAngle > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }
  return { altitude: elevation + refraction(elevation), azimuth, declination, equationOfTime };
}

export interface LocalDate { year: number; month: number; day: number }

/** UTC milliseconds of a local clock time (minutes after midnight) in a fixed UTC offset (hours). */
export function instant(date: LocalDate, minutes: number, utcOffset: number): number {
  return Date.UTC(date.year, date.month - 1, date.day) + (minutes - utcOffset * 60) * 60_000;
}

export interface SunDay {
  /** Local clock minutes after midnight; null when the sun does not rise or set that day. */
  sunrise: number | null;
  sunset: number | null;
  noon: number;
  /** Minutes of daylight (between sunrise and sunset). */
  dayLength: number;
  polar: "day" | "night" | null;
}

/** Sunrise and sunset use the standard 0.833° below the horizon (refraction and the sun's radius). */
export function sunDay(date: LocalDate, lat: number, lon: number, utcOffset: number): SunDay {
  const at = (minutes: number) => orbit(instant(date, minutes, utcOffset));
  const noonAt = (o: Orbit) => 720 - 4 * lon - o.equationOfTime + utcOffset * 60;
  let noon = noonAt(at(720));
  noon = noonAt(at(noon));
  const hourAngle = (o: Orbit): number | "day" | "night" => {
    const x = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(o.declination * RAD)) - Math.tan(lat * RAD) * Math.tan(o.declination * RAD);
    if (x > 1) return "night";
    if (x < -1) return "day";
    return Math.acos(x) * DEG;
  };
  const first = hourAngle(at(noon));
  if (typeof first !== "number") return { sunrise: null, sunset: null, noon, dayLength: first === "day" ? 1440 : 0, polar: first };
  // One refinement with the sun's declination at the estimated sunrise and sunset.
  const refine = (sign: -1 | 1): number => {
    const estimate = noon + sign * first * 4;
    const o = at(estimate);
    const h = hourAngle(o);
    return noonAt(o) + sign * (typeof h === "number" ? h : first) * 4;
  };
  const sunrise = refine(-1);
  const sunset = refine(1);
  return { sunrise, sunset, noon, dayLength: sunset - sunrise, polar: null };
}

/** "06:14" from minutes after midnight. */
export function clock(minutes: number): string {
  const m = Math.round(mod(minutes, 1440));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Spanish compass name of an azimuth: Norte, Noreste, Este… */
export function compass(azimuth: number): string {
  const names = ["Norte", "Noreste", "Este", "Sureste", "Sur", "Suroeste", "Oeste", "Noroeste"];
  return names[Math.round(mod(azimuth, 360) / 45) % 8];
}
