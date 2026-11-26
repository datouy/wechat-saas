package com.linlituan.saas.groupbuy;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/group-buys")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class GroupBuyController {
    private final GroupBuyService service;

    public GroupBuyController(GroupBuyService service) {
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

    @PostMapping
    public ApiResponse<GroupBuyDtos.View> create(@Valid @RequestBody GroupBuyDtos.CreateRequest request) {
        GroupBuy group = service.create(TenantContext.require().tenantId(), request);
        return ApiResponse.ok(service.get(group.getTenantId(), group.getId()));
    }

    @PutMapping("/{id}")
    public ApiResponse<GroupBuyDtos.View> update(@PathVariable Long id,
                                                 @RequestBody GroupBuyDtos.UpdateRequest request) {
        return ApiResponse.ok(service.update(TenantContext.require().tenantId(), id, request));
    }

    @PostMapping("/{id}/cancel")
    public ApiResponse<GroupBuyDtos.View> cancel(@PathVariable Long id) {
        return ApiResponse.ok(service.cancel(TenantContext.require().tenantId(), id));
    }
}

