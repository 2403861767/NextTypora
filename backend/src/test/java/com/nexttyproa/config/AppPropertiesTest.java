package com.nexttyproa.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class AppPropertiesTest {

    @Test
    void blankTokenIsReplacedWithRandomToken() {
        AppProperties first = new AppProperties();
        first.setAuthToken("");
        first.afterPropertiesSet();
        AppProperties second = new AppProperties();
        second.afterPropertiesSet();

        assertFalse(first.getAuthToken().isBlank());
        assertEquals(64, first.getAuthToken().length());
        assertNotEquals("dev-token-change-me", second.getAuthToken());
        assertNotEquals(first.getAuthToken(), second.getAuthToken());
    }

    @Test
    void configuredTokenIsKept() {
        AppProperties properties = new AppProperties();
        properties.setAuthToken("configured-token");
        properties.afterPropertiesSet();

        assertEquals("configured-token", properties.getAuthToken());
    }
}
