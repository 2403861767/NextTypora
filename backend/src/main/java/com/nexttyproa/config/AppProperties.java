package com.nexttyproa.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.HexFormat;

@Component
@ConfigurationProperties(prefix = "nexttyproa")
public class AppProperties implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(AppProperties.class);

    private String authToken = "";
    private String vaultPath = "";

    /**
     * No token configured → generate a random one, so the backend never accepts a well-known or empty token.
     * Runs after @ConfigurationProperties binding; the token is printed as NEXTTYPROA_TOKEN= on startup.
     */
    @Override
    public void afterPropertiesSet() {
        if (authToken == null || authToken.isBlank()) {
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            authToken = HexFormat.of().formatHex(bytes);
            log.info("No auth token configured; generated a random token for this run");
        }
    }

    public String getAuthToken() {
        return authToken;
    }

    public void setAuthToken(String authToken) {
        this.authToken = authToken;
    }

    public String getVaultPath() {
        return vaultPath;
    }

    public void setVaultPath(String vaultPath) {
        this.vaultPath = vaultPath;
    }
}
