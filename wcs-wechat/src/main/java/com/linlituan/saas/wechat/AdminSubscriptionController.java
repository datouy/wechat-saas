package com.linlituan.saas.wechat;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/admin/subscriptions")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class AdminSubscriptionController {
    private final WechatSubscriptionService service;

    public AdminSubscriptionController(WechatSubscriptionService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<Object> view() {
        Long tenantId = TenantContext.require().tenantId();
        return ApiResponse.ok(java.util.Map.of("templates", service.templates(), "outbox", service.outbox(tenantId)));
    }

    @PostMapping("/test")
    public ApiResponse<NotificationOutbox> test(@RequestBody WechatDtos.SubscriptionTestRequest request) {
        return ApiResponse.ok(service.test(TenantContext.require().tenantId(), request));
    }
}

