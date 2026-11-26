package com.linlituan.saas.wechat;

import com.linlituan.saas.common.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/wx")
public class WechatLoginController {
    private final WechatAuthService authService;
    private final String defaultTenant;

    public WechatLoginController(WechatAuthService authService, Environment environment) {
        this.authService = authService;
        this.defaultTenant = environment.getProperty("app.tenant.default-code", "t-default");
    }

    @PostMapping("/login")
    public ApiResponse<WechatDtos.LoginResponse> login(@RequestHeader(value = "X-Tenant-Id", required = false) String tenant,
                                                       @Valid @RequestBody WechatDtos.LoginRequest request) {
        return ApiResponse.ok(authService.login(tenant == null || tenant.isBlank() ? defaultTenant : tenant, request.code()));
    }
}

