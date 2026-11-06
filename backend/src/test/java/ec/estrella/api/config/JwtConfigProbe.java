package ec.estrella.api.config;

import javax.crypto.SecretKey;

/** Exposes the package-private key check to tests in other packages. */
public final class JwtConfigProbe {

    private JwtConfigProbe() {
    }

    public static SecretKey key(String secret) {
        return JwtConfig.toKey(secret);
    }
}
