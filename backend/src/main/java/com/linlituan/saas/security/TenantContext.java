package com.linlituan.saas.security;

import java.util.Optional;

public final class TenantContext {
    private static final ThreadLocal<Context> HOLDER = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(Context context) {
        HOLDER.set(context);
    }

    public static Context require() {
        return Optional.ofNullable(HOLDER.get())
                .orElseThrow(() -> new IllegalStateException("缺少租户上下文"));
    }

    public static void clear() {
        HOLDER.remove();
    }

    public record Context(Long userId, Long tenantId, String username, String role) {
    }
}

