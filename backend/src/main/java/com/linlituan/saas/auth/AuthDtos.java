package com.linlituan.saas.auth;

import jakarta.validation.constraints.NotBlank;

public final class AuthDtos {
    private AuthDtos() {
    }

    public record LoginRequest(
            @NotBlank(message = "请输入租户标识") String tenantCode,
            @NotBlank(message = "请输入用户名") String username,
            @NotBlank(message = "请输入密码") String password
    ) {
    }

    public record UserView(Long id, String username, String displayName, String role) {
    }

    public record TenantView(Long id, String code, String name, String status) {
    }

    public record LoginResponse(String token, UserView user, TenantView tenant) {
    }
}

