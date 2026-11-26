package com.linlituan.saas.tenant;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tenant")
public class TenantController {
    private final TenantRepository tenants;

    public TenantController(TenantRepository tenants) {
        this.tenants = tenants;
    }

    @GetMapping
    public ApiResponse<TenantView> current() {
        TenantContext.Context context = TenantContext.require();
        Tenant tenant = tenants.findById(context.tenantId()).orElseThrow();
        return ApiResponse.ok(new TenantView(tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getStatus()));
    }

    public record TenantView(Long id, String code, String name, String status) {
    }
}

