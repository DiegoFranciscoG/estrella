package ec.estrella.api.auth;

import java.util.Locale;

/**
 * Coarse device description for the new-session email ("Chrome en Windows").
 * Deliberately coarse: the full user agent is never stored or echoed.
 */
public final class DeviceLabel {

    private DeviceLabel() {
    }

    public static String of(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) {
            return "un dispositivo desconocido";
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        return browser(ua) + " en " + system(ua);
    }

    private static String browser(String ua) {
        if (ua.contains("edg/")) {
            return "Edge";
        }
        if (ua.contains("firefox/")) {
            return "Firefox";
        }
        if (ua.contains("chrome/") || ua.contains("crios/")) {
            return "Chrome";
        }
        if (ua.contains("safari/")) {
            return "Safari";
        }
        return "un navegador";
    }

    private static String system(String ua) {
        if (ua.contains("android")) {
            return "Android";
        }
        if (ua.contains("iphone") || ua.contains("ipad")) {
            return "iOS";
        }
        if (ua.contains("windows")) {
            return "Windows";
        }
        if (ua.contains("mac os")) {
            return "macOS";
        }
        if (ua.contains("linux")) {
            return "Linux";
        }
        return "un sistema desconocido";
    }
}
