package com.linlituan.saas.wechat;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/wx/subscriptions")
public class MemberSubscriptionController {
    private final WechatSubscriptionService service;

    public MemberSubscriptionController(WechatSubscriptionService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<WechatDtos.SubscriptionView> view() {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.view(context.tenantId(), context.userId()));
    }

    @PostMapping("/authorize")
    public ApiResponse<Long> authorize(@RequestBody WechatDtos.AuthorizeRequest request) {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.authorize(context.tenantId(), context.userId(), request.decisions()).getId());
    }
}

