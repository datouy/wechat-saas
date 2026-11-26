package com.linlituan.saas.auth;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import com.linlituan.saas.tenant.Tenant;
import com.linlituan.saas.tenant.TenantRepository;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final TenantRepository tenants;

    public AuthController(AuthService authService, TenantRepository tenants) {
        this.authService = authService;
        this.tenants = tenants;
    }

    @PostMapping("/login")
    public ApiResponse<AuthDtos.LoginResponse> login(@Valid @RequestBody AuthDtos.LoginRequest request) {
        return ApiResponse.ok(authService.login(request));
    }

    @GetMapping("/me")
    public ApiResponse<AuthDtos.UserView> me() {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(new AuthDtos.UserView(context.userId(), context.username(), context.username(), context.role()));
    }
}

