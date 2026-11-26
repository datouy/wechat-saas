package com.linlituan.saas.groupbuy;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/wx/group-buys")
public class MemberGroupBuyController {
    private final GroupBuyService service;

    public MemberGroupBuyController(GroupBuyService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<GroupBuyDtos.View>> list(@RequestParam(required = false) String status) {
        return ApiResponse.ok(service.list(TenantContext.require().tenantId(), status));
    }

    @GetMapping("/{id}")
    public ApiResponse<GroupBuyDtos.View> detail(@PathVariable Long id) {
        return ApiResponse.ok(service.get(TenantContext.require().tenantId(), id));
    }

    @PostMapping("/{id}/join")
    public ApiResponse<GroupBuyDtos.View> join(@PathVariable Long id) {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.join(context.tenantId(), id, context.userId()));
    }
}

