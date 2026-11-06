package ec.estrella.api.common;

import jakarta.servlet.http.HttpServletRequest;

/** Remote address after Spring's forwarded-header handling (server.forward-headers-strategy). */
public final class ClientIp {

    private ClientIp() {
    }

    public static String of(HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        return ip == null ? "unknown" : ip;
    }
}
